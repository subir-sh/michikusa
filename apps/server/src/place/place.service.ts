import {
  BadRequestException,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Photo } from '../photo/photo.entity';
import { PhotoService } from '../photo/photo.service';
import {
  UnassignVisitResult,
  VisitAssignment,
  VisitService,
} from '../visit/visit.service';
import { Place } from './place.entity';

const PLACES_ENDPOINT = 'https://places.googleapis.com/v1/places:searchNearby';
const FIELD_MASK = [
  'places.id',
  'places.displayName',
  'places.location',
  'places.primaryType',
  'places.types',
  'places.formattedAddress',
].join(',');

interface GooglePlace {
  id?: string;
  displayName?: { text?: string };
  location?: { latitude?: number; longitude?: number };
  primaryType?: string;
  types?: string[];
  formattedAddress?: string;
}

interface GooglePlacesResponse {
  places?: GooglePlace[];
  error?: { message?: string };
}

interface CategoryConfig {
  radius: number;
  types: string[];
}

const CATEGORY_CONFIG: Record<string, CategoryConfig> = {
  food: {
    radius: 120,
    types: ['restaurant', 'cafe', 'coffee_shop', 'bakery', 'bar', 'food_court'],
  },
  restaurant: {
    radius: 120,
    types: ['restaurant', 'cafe', 'coffee_shop', 'bakery', 'bar', 'food_court'],
  },
  landmark: {
    radius: 500,
    types: [
      'museum',
      'art_gallery',
      'cultural_landmark',
      'historical_place',
      'monument',
      'historical_landmark',
      'tourist_attraction',
      'observation_deck',
      'aquarium',
      'zoo',
      'amusement_park',
      'video_arcade',
      'shinto_shrine',
      'buddhist_temple',
      'university',
    ],
  },
  accommodation: {
    radius: 250,
    types: [
      'hotel',
      'lodging',
      'hostel',
      'japanese_inn',
      'budget_japanese_inn',
      'guest_house',
      'resort_hotel',
      'inn',
    ],
  },
  transit: {
    radius: 300,
    types: [
      'train_station',
      'subway_station',
      'light_rail_station',
      'transit_station',
      'bus_station',
      'bus_stop',
      'airport',
      'international_airport',
      'ferry_terminal',
    ],
  },
  nature: {
    radius: 600,
    types: [
      'park',
      'city_park',
      'garden',
      'botanical_garden',
      'national_park',
      'state_park',
      'beach',
      'scenic_spot',
      'nature_preserve',
    ],
  },
  street: {
    radius: 120,
    types: [],
  },
};

export interface PlaceCandidate {
  placeId: string;
  name: string;
  latitude: number;
  longitude: number;
  primaryType: string | null;
  types: string[];
  formattedAddress: string | null;
  distanceMeters: number;
  score: number;
}

export interface PlaceCandidatesResult {
  photo: {
    id: number;
    category: string | null;
    latitude: number | null;
    longitude: number | null;
    visitId: number | null;
  };
  assignment: VisitAssignment | null;
  eligible: boolean;
  reason?: string;
  radius: number | null;
  candidates: PlaceCandidate[];
}

export interface ConfirmPlaceResult {
  photoId: number;
  placeId: number;
  visitId: number;
  googlePlaceId: string;
  createdPlace: boolean;
  createdVisit: boolean;
  replaced: boolean;
  previousVisitId: number | null;
  visitMergeWindowHours: number;
}

@Injectable()
export class PlaceService {
  private readonly apiKey: string;

  constructor(
    config: ConfigService,
    private readonly photoService: PhotoService,
    private readonly visitService: VisitService,
    @InjectRepository(Place)
    private readonly placeRepository: Repository<Place>,
  ) {
    this.apiKey = config.get<string>('GOOGLE_PLACES_API_KEY') ?? '';
  }

  async findCandidates(photoId: number): Promise<PlaceCandidatesResult> {
    const photo = await this.photoService.findById(photoId);
    const assignment = await this.visitService.getAssignment(photoId);
    const photoSummary = {
      id: photo.id,
      category: photo.category,
      latitude: photo.latitude,
      longitude: photo.longitude,
      visitId: photo.visitId,
    };

    if (photo.latitude === null || photo.longitude === null) {
      return {
        photo: photoSummary,
        assignment,
        eligible: false,
        reason: 'GPS가 없는 사진은 아직 POI 후보를 조회하지 않는다.',
        radius: null,
        candidates: [],
      };
    }

    if (!photo.category) {
      return {
        photo: photoSummary,
        assignment,
        eligible: false,
        reason: 'SigLIP2 분류를 먼저 실행해야 한다.',
        radius: null,
        candidates: [],
      };
    }

    const categoryConfig = CATEGORY_CONFIG[photo.category];
    if (!categoryConfig) {
      return {
        photo: photoSummary,
        assignment,
        eligible: false,
        reason: `${photo.category} category는 현재 POI 후보 조회 대상이 아니다.`,
        radius: null,
        candidates: [],
      };
    }

    if (!this.apiKey) {
      throw new ServiceUnavailableException(
        'GOOGLE_PLACES_API_KEY is not configured',
      );
    }

    const body: Record<string, unknown> = {
      maxResultCount: 10,
      rankPreference: 'DISTANCE',
      locationRestriction: {
        circle: {
          center: {
            latitude: photo.latitude,
            longitude: photo.longitude,
          },
          radius: categoryConfig.radius,
        },
      },
    };

    if (categoryConfig.types.length > 0) {
      body.includedTypes = categoryConfig.types;
    }

    const response = await fetch(PLACES_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': this.apiKey,
        'X-Goog-FieldMask': FIELD_MASK,
      },
      body: JSON.stringify(body),
    });

    const payload = (await response.json()) as GooglePlacesResponse;
    if (!response.ok) {
      throw new ServiceUnavailableException(
        payload.error?.message ?? `Google Places request failed (${response.status})`,
      );
    }

    const candidates = (payload.places ?? [])
      .map((place): PlaceCandidate | null => {
        const placeId = place.id;
        const latitude = place.location?.latitude;
        const longitude = place.location?.longitude;

        if (
          !placeId ||
          typeof latitude !== 'number' ||
          typeof longitude !== 'number'
        ) {
          return null;
        }

        const distanceMeters = haversineDistanceMeters(
          photo.latitude as number,
          photo.longitude as number,
          latitude,
          longitude,
        );
        const proximity = Math.max(
          0,
          1 - distanceMeters / categoryConfig.radius,
        );
        const primaryMatch =
          categoryConfig.types.length === 0
            ? 1
            : place.primaryType && categoryConfig.types.includes(place.primaryType)
              ? 1
              : 0.6;
        const score =
          Math.round((proximity * 0.7 + primaryMatch * 0.3) * 1000) / 1000;

        return {
          placeId,
          name: place.displayName?.text ?? placeId,
          latitude,
          longitude,
          primaryType: place.primaryType ?? null,
          types: place.types ?? [],
          formattedAddress: place.formattedAddress ?? null,
          distanceMeters: Math.round(distanceMeters),
          score,
        };
      })
      .filter((candidate): candidate is PlaceCandidate => candidate !== null)
      .sort((a, b) => b.score - a.score || a.distanceMeters - b.distanceMeters);

    return {
      photo: photoSummary,
      assignment,
      eligible: true,
      radius: categoryConfig.radius,
      candidates,
    };
  }

  async confirm(
    photoId: number,
    googlePlaceId: string,
  ): Promise<ConfirmPlaceResult> {
    const photo = await this.photoService.findById(photoId);
    const currentAssignment = await this.visitService.getAssignment(photoId);

    if (currentAssignment?.googlePlaceId === googlePlaceId) {
      return {
        photoId,
        placeId: currentAssignment.placeId,
        visitId: currentAssignment.visitId,
        googlePlaceId,
        createdPlace: false,
        createdVisit: false,
        replaced: false,
        previousVisitId: currentAssignment.visitId,
        visitMergeWindowHours: this.visitService.getMergeWindowHours(),
      };
    }

    const candidateResult = await this.findCandidates(photoId);
    const candidate = candidateResult.candidates.find(
      (item) => item.placeId === googlePlaceId,
    );
    if (!candidate) {
      throw new BadRequestException(
        'The selected Google Place is not a current candidate for this photo',
      );
    }

    if (photo.latitude === null || photo.longitude === null) {
      throw new BadRequestException('Photo GPS is required');
    }

    let createdPlace = false;
    const result = await this.placeRepository.manager.transaction(
      async (manager) => {
        if (photo.visitId !== null) {
          await this.visitService.unassignPhoto(manager, photo);
        }

        let place = await manager.findOne(Place, {
          where: { googlePlaceId },
        });

        if (!place) {
          place = manager.create(Place, {
            googlePlaceId,
            latitude: photo.latitude as number,
            longitude: photo.longitude as number,
            category: photo.category,
          });
          place = await manager.save(place);
          createdPlace = true;
        }

        const assigned = await this.visitService.assignPhoto(manager, place, photo);
        await manager.update(Photo, photo.id, { visitId: assigned.visit.id });

        return {
          place,
          visit: assigned.visit,
          createdVisit: assigned.created,
        };
      },
    );

    return {
      photoId: photo.id,
      placeId: result.place.id,
      visitId: result.visit.id,
      googlePlaceId: result.place.googlePlaceId,
      createdPlace,
      createdVisit: result.createdVisit,
      replaced: currentAssignment !== null,
      previousVisitId: currentAssignment?.visitId ?? null,
      visitMergeWindowHours: this.visitService.getMergeWindowHours(),
    };
  }

  async unassign(photoId: number): Promise<UnassignVisitResult> {
    const photo = await this.photoService.findById(photoId);
    return this.placeRepository.manager.transaction((manager) =>
      this.visitService.unassignPhoto(manager, photo),
    );
  }
}

function haversineDistanceMeters(
  latitudeA: number,
  longitudeA: number,
  latitudeB: number,
  longitudeB: number,
) {
  const earthRadius = 6_371_000;
  const toRadians = (degrees: number) => (degrees * Math.PI) / 180;
  const latitudeDelta = toRadians(latitudeB - latitudeA);
  const longitudeDelta = toRadians(longitudeB - longitudeA);
  const a =
    Math.sin(latitudeDelta / 2) ** 2 +
    Math.cos(toRadians(latitudeA)) *
      Math.cos(toRadians(latitudeB)) *
      Math.sin(longitudeDelta / 2) ** 2;

  return earthRadius * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

import {
  Column,
  Entity,
  JoinColumn,
  ManyToOne,
  OneToMany,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { Photo } from '../photo/photo.entity';
import { Place } from '../place/place.entity';

@Entity()
export class Visit {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column()
  placeId!: number;

  @ManyToOne(() => Place, (place) => place.visits, {
    nullable: false,
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'placeId' })
  place!: Place;

  @Column({ type: 'datetime' })
  visitedAt!: Date;

  @OneToMany(() => Photo, (photo) => photo.visit)
  photos!: Photo[];
}

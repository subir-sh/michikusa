import { Column, Entity, ManyToOne, OneToMany, PrimaryGeneratedColumn } from 'typeorm';
import { Photo } from '../photo/photo.entity';
import { Place } from '../place/place.entity';

@Entity()
export class Visit {
  @PrimaryGeneratedColumn()
  id!: number;

  @ManyToOne(() => Place, (place) => place.visits, {
    nullable: false,
    onDelete: 'CASCADE',
  })
  place!: Place;

  @Column({ type: 'datetime' })
  visitedAt!: Date;

  @Column({ default: false })
  confirmed!: boolean;

  @OneToMany(() => Photo, (photo) => photo.visit)
  photos!: Photo[];
}

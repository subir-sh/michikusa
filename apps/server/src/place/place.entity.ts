import { Column, Entity, OneToMany, PrimaryGeneratedColumn } from 'typeorm';
import { Visit } from '../visit/visit.entity';

@Entity()
export class Place {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column({ type: 'real' })
  latitude!: number;

  @Column({ type: 'real' })
  longitude!: number;

  @Column({ type: 'text', nullable: true })
  category!: string | null;

  @Column({ type: 'text', unique: true })
  googlePlaceId!: string;

  @OneToMany(() => Visit, (visit) => visit.place)
  visits!: Visit[];
}

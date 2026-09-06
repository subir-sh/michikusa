import { Column, Entity, OneToMany, PrimaryGeneratedColumn } from 'typeorm';
import { Visit } from '../visit/visit.entity';

@Entity()
export class Place {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column()
  name!: string;

  @Column({ type: 'real' })
  latitude!: number;

  @Column({ type: 'real' })
  longitude!: number;

  @Column({ type: 'text', nullable: true })
  category!: string | null;

  @Column({ type: 'text', nullable: true, unique: true })
  googlePlaceId!: string | null;

  @OneToMany(() => Visit, (visit) => visit.place)
  visits!: Visit[];
}

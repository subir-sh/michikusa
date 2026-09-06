import { Column, Entity, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import { Visit } from '../visit/visit.entity';

@Entity()
export class Photo {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column({ unique: true })
  hash!: string;

  @Column()
  path!: string;

  @Column({ type: 'datetime' })
  capturedAt!: Date;

  @Column({ type: 'real', nullable: true })
  latitude!: number | null;

  @Column({ type: 'real', nullable: true })
  longitude!: number | null;

  @Column({ default: false })
  locationInferred!: boolean;

  @Column({ type: 'text', nullable: true })
  category!: string | null;

  @ManyToOne(() => Visit, (visit) => visit.photos, {
    nullable: true,
    onDelete: 'SET NULL',
  })
  visit!: Visit | null;
}

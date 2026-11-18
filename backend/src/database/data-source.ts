import 'reflect-metadata';
import { DataSource, DataSourceOptions } from 'typeorm';
import { env } from '../common/env';
import { ENTITIES } from './entities';
import { InitSchema1763030000000 } from './migrations/1763030000000-InitSchema';
import { AbsenceSlaPerf1763100000000 } from './migrations/1763100000000-AbsenceSlaPerf';

export const dataSourceOptions: DataSourceOptions = {
  type: 'mysql',
  host: env.db.host,
  port: env.db.port,
  username: env.db.user,
  password: env.db.password,
  database: env.db.name,
  timezone: 'Z',
  charset: 'utf8mb4',
  entities: ENTITIES,
  migrations: [InitSchema1763030000000, AbsenceSlaPerf1763100000000],
  synchronize: false,
  logging: false,
};

export default new DataSource(dataSourceOptions);

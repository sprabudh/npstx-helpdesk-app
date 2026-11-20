import 'reflect-metadata';
import { DataSource, DataSourceOptions } from 'typeorm';
import { env } from '../common/env';
import { ENTITIES } from './entities';
import { InitSchema1763030000000 } from './migrations/1763030000000-InitSchema';
import { AbsenceSlaPerf1763100000000 } from './migrations/1763100000000-AbsenceSlaPerf';
import { ApprovalSlaStart1763200000000 } from './migrations/1763200000000-ApprovalSlaStart';
import { NotificationEvents1763300000000 } from './migrations/1763300000000-NotificationEvents';

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
  migrations: [InitSchema1763030000000, AbsenceSlaPerf1763100000000, ApprovalSlaStart1763200000000, NotificationEvents1763300000000],
  synchronize: false,
  logging: false,
};

export default new DataSource(dataSourceOptions);

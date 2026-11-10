/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2026 Hexastack.
 * Full terms: see LICENSE.md.
 */

import { DataSource, EntitySubscriberInterface } from 'typeorm';

/**
 * Adds a subscriber to the data source, unless it is already registered.
 *
 * @param dataSource - The data source to listen to.
 * @param subscriber - The subscriber instance.
 */
export const registerOrmSubscriber = (
  dataSource: DataSource,
  subscriber: EntitySubscriberInterface<any>,
): void => {
  const alreadyRegistered = dataSource.subscribers.some(
    (registered) => registered === subscriber,
  );
  if (!alreadyRegistered) {
    dataSource.subscribers.push(subscriber);
  }
};

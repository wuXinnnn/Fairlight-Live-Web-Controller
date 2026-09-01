import { useState } from 'react';

export const TYPE_ROWS_STORAGE_KEY = 'flwc.layout.typeRows';

export function readTypeRowsPreference(storage: Pick<Storage, 'getItem'>): boolean {
  return storage.getItem(TYPE_ROWS_STORAGE_KEY) === 'true';
}

export function useTypeRowsPreference(): [boolean, () => void] {
  const [typeRows, setTypeRows] = useState(() => {
    try {
      return readTypeRowsPreference(window.localStorage);
    } catch (error) {
      console.warn('Unable to read the channel layout preference.', error);
      return false;
    }
  });

  const toggle = () => {
    setTypeRows((current) => {
      const next = !current;
      try {
        window.localStorage.setItem(TYPE_ROWS_STORAGE_KEY, String(next));
      } catch (error) {
        console.warn('Unable to save the channel layout preference.', error);
      }
      return next;
    });
  };

  return [typeRows, toggle];
}

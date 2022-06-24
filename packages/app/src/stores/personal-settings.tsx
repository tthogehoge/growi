import useSWR, { SWRResponse } from 'swr';


import { Nullable } from '~/interfaces/common';
import { IExternalAccount } from '~/interfaces/external-account';
import { IUser } from '~/interfaces/user';

import { apiv3Get, apiv3Put } from '../client/util/apiv3-client';

import { useStaticSWR } from './use-static-swr';


const useSWRxPersonalSettingsInfo = (): SWRResponse<IUser, Error> => {
  return useSWR(
    '/personal-setting',
    endpoint => apiv3Get(endpoint).then(response => response.data.currentUser),
  );
};

export type IPersonalSettingsInfoOption = {
  personalSettingsDataFromDB: Nullable<IUser>,
  sync: () => void,
  update: () => void,
}

export const usePersonalSettingsInfo = (): SWRResponse<IUser, Error> & IPersonalSettingsInfoOption => {
  const { data: personalSettingsDataFromDB } = useSWRxPersonalSettingsInfo();

  const swrResult = useStaticSWR<IUser, Error>('personalSettingsInfo', undefined);

  return {
    ...swrResult,
    personalSettingsDataFromDB,
    sync: (): void => {
      const { mutate } = swrResult;
      mutate(personalSettingsDataFromDB);
    },
    update: () => {
      const { data, mutate } = swrResult;

      if (data == null) {
        return;
      }

      mutate({ ...data }, false);

      const updateData = {
        name: data.name,
        email: data.email,
        isEmailPublished: data.isEmailPublished,
        lang: data.lang,
        slackMemberId: data.slackMemberId,
      };

      // invoke API
      apiv3Put('/personal-setting/', updateData);
    },
  };
};


export const useSWRxPersonalExternalAccounts = (): SWRResponse<IExternalAccount[], Error> => {
  return useSWR(
    '/personal-setting/external-accounts',
    endpoint => apiv3Get(endpoint).then(response => response.data.externalAccounts),
  );
};

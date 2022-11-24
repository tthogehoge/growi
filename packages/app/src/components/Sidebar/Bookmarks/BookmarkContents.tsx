import React, { useCallback, useState } from 'react';

import { useTranslation } from 'next-i18next';

import { toastError, toastSuccess } from '~/client/util/apiNotification';
import { apiv3Post } from '~/client/util/apiv3-client';
import FolderPlusIcon from '~/components/Icons/FolderPlusIcon';
import { useSWRxBookamrkFolderAndChild } from '~/stores/bookmark-folder';

import BookmarkFolderNameInput from './BookmarkFolderNameInput';
import BookmarkFolderTree from './BookmarkFolderTree';


const BookmarkContents = (): JSX.Element => {

  const { t } = useTranslation();
  const [isCreateAction, setIsCreateAction] = useState<boolean>(false);
  const { mutate: mutateChildBookmarkData } = useSWRxBookamrkFolderAndChild(null);


  const onClickNewBookmarkFolder = useCallback(() => {
    setIsCreateAction(true);
  }, []);

  const onPressEnterHandlerForCreate = useCallback(async(folderName: string) => {

    try {
      await apiv3Post('/bookmark-folder', { name: folderName, parent: null });
      await mutateChildBookmarkData();
      setIsCreateAction(false);
      toastSuccess(t('toaster.create_succeeded', { target: t('bookmark_folder.bookmark_folder') }));
    }
    catch (err) {
      toastError(err);
    }

  }, [mutateChildBookmarkData, t]);

  const renderAddNewBookmarkFolder = () => (
    <>
      <div className="col-8 mb-2 ">
        <button
          className="btn btn-block btn-outline-secondary rounded-pill d-flex justify-content-start align-middle"
          onClick={onClickNewBookmarkFolder}
        >
          <FolderPlusIcon />
          <span className="mx-2 ">{t('bookmark_folder.new_folder')}</span>
        </button>
      </div>
      {
        isCreateAction && (
          <div className="col-12 mb-2 ">
            <BookmarkFolderNameInput
              onClickOutside={() => setIsCreateAction(false)}
              onPressEnter={onPressEnterHandlerForCreate}
            />
          </div>
        )
      }
    </>
  );

  return (
    <>
      {
        renderAddNewBookmarkFolder()
      }
      <BookmarkFolderTree />
    </>
  );
};

export default BookmarkContents;

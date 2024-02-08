import type { FC } from 'react';
import { useCallback } from 'react';

import nodePath from 'path';

import { type IPageForItem } from '~/interfaces/page';
import { useSWRxCurrentPage } from '~/stores/page';

import { usePagePathRenameHandler } from '../PageEditor/page-path-rename-utils';
import {
  SimpleItem, useNewPageInput, type TreeItemProps,
} from '../TreeItem';


type PageTreeItemProps = TreeItemProps & {
  key?: React.Key | null,
};

export const TreeItemForModal: FC<PageTreeItemProps> = (props) => {

  const { isOpen } = props;

  const { data: currentPage } = useSWRxCurrentPage();
  const { Input: NewPageInput, CreateButton: NewPageCreateButton } = useNewPageInput();
  const pagePathRenameHandler = usePagePathRenameHandler(currentPage);

  const currentPageTitle = nodePath.basename(currentPage?.path ?? '') || '/';


  const onClick = useCallback((page: IPageForItem) => {
    const parentPagePath = page.path;

    if (parentPagePath == null) {
      return;
    }

    const newPagePath = nodePath.resolve(parentPagePath, currentPageTitle);

    pagePathRenameHandler(newPagePath);
  }, [currentPageTitle, pagePathRenameHandler]);

  return (
    <SimpleItem
      key={props.key}
      targetPathOrId={props.targetPathOrId}
      itemNode={props.itemNode}
      isOpen={isOpen}
      isEnableActions={props.isEnableActions}
      isReadOnlyUser={props.isReadOnlyUser}
      onClickDuplicateMenuItem={props.onClickDuplicateMenuItem}
      onClickDeleteMenuItem={props.onClickDeleteMenuItem}
      onRenamed={props.onRenamed}
      customNextComponents={[NewPageInput]}
      itemClass={TreeItemForModal}
      customEndComponents={[NewPageCreateButton]}
      onClick={onClick}
    />
  );
};

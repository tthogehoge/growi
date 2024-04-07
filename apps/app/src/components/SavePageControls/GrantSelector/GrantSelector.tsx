import React, { useCallback, useEffect, useState } from 'react';

import {
  PageGrant, GroupType, getIdForRef,
} from '@growi/core';
import { LoadingSpinner } from '@growi/ui/dist/components';
import { useTranslation } from 'next-i18next';
import {
  UncontrolledDropdown,
  DropdownToggle, DropdownMenu, DropdownItem,

  Modal, ModalHeader, ModalBody,
} from 'reactstrap';

import type { UserRelatedGroupsData } from '~/interfaces/page';
import { UserGroupPageGrantStatus } from '~/interfaces/page';
import { useCurrentUser } from '~/stores/context';
import { useCurrentPageId, useSWRxIsGrantNormalized } from '~/stores/page';
import { useSelectedGrant } from '~/stores/ui';


const AVAILABLE_GRANTS = [
  {
    grant: PageGrant.GRANT_PUBLIC, iconName: 'group', btnStyleClass: 'outline-info', label: 'Public',
  },
  {
    grant: PageGrant.GRANT_RESTRICTED, iconName: 'link', btnStyleClass: 'outline-success', label: 'Anyone with the link',
  },
  // { grant: 3, iconClass: '', label: 'Specified users only' },
  {
    grant: PageGrant.GRANT_OWNER, iconName: 'lock', btnStyleClass: 'outline-danger', label: 'Only me',
  },
  {
    grant: PageGrant.GRANT_USER_GROUP,
    iconName: 'more_horiz',
    btnStyleClass: 'outline-warning',
    label: 'Only inside the group',
    reselectLabel: 'Reselect the group',
  },
];


type Props = {
  disabled?: boolean,
  openInModal?: boolean,
}

/**
 * Page grant select component
 */
export const GrantSelector = (props: Props): JSX.Element => {
  const { t } = useTranslation();

  const {
    disabled,
    openInModal,
  } = props;


  const [isSelectGroupModalShown, setIsSelectGroupModalShown] = useState(false);

  const { data: currentUser } = useCurrentUser();

  const shouldFetch = isSelectGroupModalShown;
  const { data: selectedGrant, mutate: mutateSelectedGrant } = useSelectedGrant();
  const { data: currentPageId } = useCurrentPageId();
  const { data: grantData } = useSWRxIsGrantNormalized(currentPageId);

  const currentPageGrantData = grantData?.grantData.currentPageGrant;
  const groupGrantData = currentPageGrantData?.groupGrantData;

  const applyCurrentPageGrantToSelectedGrant = useCallback(() => {
    const currentPageGrant = grantData?.grantData.currentPageGrant;
    if (currentPageGrant == null) return;

    const userRelatedGrantedGroups = currentPageGrant.groupGrantData
      ?.userRelatedGroups.filter(group => group.status === UserGroupPageGrantStatus.isGranted)?.map((group) => {
        return { item: group.id, type: group.type };
      }) ?? [];
    mutateSelectedGrant({
      grant: currentPageGrant.grant,
      userRelatedGrantedGroups,
    });
  }, [grantData?.grantData.currentPageGrant, mutateSelectedGrant]);

  // sync grant data
  useEffect(() => {
    applyCurrentPageGrantToSelectedGrant();
  }, [applyCurrentPageGrantToSelectedGrant]);

  const showSelectGroupModal = useCallback(() => {
    setIsSelectGroupModalShown(true);
  }, []);

  const updateGrantHandler = useCallback((grantData: IPageGrantData): void => {
    mutateGrant(grantData);
  }, [mutateGrant]);

  /**
   * change event handler for grant selector
   */
  const changeGrantHandler = useCallback((grant: PageGrant) => {
    // select group
    if (grant === 5) {
      if (selectedGrant?.grant !== 5) applyCurrentPageGrantToSelectedGrant();
      showSelectGroupModal();
      return;
    }

    mutateSelectedGrant({ grant, userRelatedGrantedGroups: undefined });
  }, [mutateSelectedGrant, showSelectGroupModal, applyCurrentPageGrantToSelectedGrant, selectedGrant?.grant]);

  const groupListItemClickHandler = useCallback((clickedGroup: UserRelatedGroupsData) => {
    const userRelatedGrantedGroups = selectedGrant?.userRelatedGrantedGroups ?? [];

    let userRelatedGrantedGroupsCopy = [...userRelatedGrantedGroups];
    if (userRelatedGrantedGroupsCopy.find(group => getIdForRef(group.item) === clickedGroup.id) == null) {
      const grantGroupInfo = { item: clickedGroup.id, type: clickedGroup.type };
      userRelatedGrantedGroupsCopy.push(grantGroupInfo);
    }
    else {
      userRelatedGrantedGroupsCopy = userRelatedGrantedGroupsCopy.filter(group => getIdForRef(group.item) !== clickedGroup.id);
    }
    mutateSelectedGrant({ grant: 5, userRelatedGrantedGroups: userRelatedGrantedGroupsCopy });
  }, [mutateSelectedGrant, selectedGrant?.userRelatedGrantedGroups]);

  /**
   * Render grant selector DOM.
   */
  const renderGrantSelector = useCallback(() => {

    let dropdownToggleBtnColor;
    let dropdownToggleLabelElm;

    const userRelatedGrantedGroups = groupGrantData?.userRelatedGroups.filter((group) => {
      return selectedGrant?.userRelatedGrantedGroups?.some(grantedGroup => getIdForRef(grantedGroup.item) === group.id);
    }) ?? [];
    const nonUserRelatedGrantedGroups = groupGrantData?.nonUserRelatedGrantedGroups ?? [];

    const dropdownMenuElems = AVAILABLE_GRANTS.map((opt) => {
      const label = ((opt.grant === 5 && opt.reselectLabel != null) && userRelatedGrantedGroups.length > 0)
        ? opt.reselectLabel // when grantGroup is selected
        : opt.label;

      const labelElm = (
        <span className={openInModal ? 'py-2' : ''}>
          <span className="material-symbols-outlined me-2">{opt.iconName}</span>
          <span className="label">{t(label)}</span>
        </span>
      );

      // set dropdownToggleBtnColor, dropdownToggleLabelElm
      if (opt.grant === 1 || opt.grant === selectedGrant?.grant) {
        dropdownToggleBtnColor = opt.btnStyleClass;
        dropdownToggleLabelElm = labelElm;
      }

      return <DropdownItem key={opt.grant} onClick={() => changeGrantHandler(opt.grant)}>{labelElm}</DropdownItem>;
    });

    // add specified group option
    if (selectedGrant?.grant === PageGrant.GRANT_USER_GROUP && (userRelatedGrantedGroups.length > 0 || nonUserRelatedGrantedGroups.length > 0)) {
      const grantedGroupNames = [...userRelatedGrantedGroups.map(group => group.name), ...nonUserRelatedGrantedGroups.map(group => group.name)];
      const labelElm = (
        <span>
          <span className="material-symbols-outlined me-1">account_tree</span>
          <span className="label">
            {grantedGroupNames.length > 1
              ? (
                <span>
                  {`${grantedGroupNames[0]}... `}
                  <span className="badge badge-purple">+{grantedGroupNames.length - 1}</span>
                </span>
              ) : grantedGroupNames[0]}
          </span>
        </span>
      );

      // set dropdownToggleLabelElm
      dropdownToggleLabelElm = labelElm;

      dropdownMenuElems.push(<DropdownItem key="groupSelected">{labelElm}</DropdownItem>);
    }

    return (
      <div className="grw-grant-selector mb-0" data-testid="grw-grant-selector">
        <UncontrolledDropdown direction={openInModal ? 'down' : 'up'} size="sm">
          <DropdownToggle color={dropdownToggleBtnColor} caret className="w-100 d-flex justify-content-between align-items-center" disabled={disabled}>
            {dropdownToggleLabelElm}
          </DropdownToggle>
          <DropdownMenu container={openInModal ? '' : 'body'}>
            {dropdownMenuElems}
          </DropdownMenu>
        </UncontrolledDropdown>
      </div>
    );
  }, [changeGrantHandler, disabled, groupGrantData, selectedGrant, t, openInModal]);

  /**
   * Render select grantgroup modal.
   */
  const renderSelectGroupModalContent = useCallback(() => {
    if (!shouldFetch) {
      return <></>;
    }

    // show spinner
    if (groupGrantData == null) {
      return (
        <div className="my-3 text-center">
          <LoadingSpinner className="mx-auto text-muted fs-4" />
        </div>
      );
    }

    const { userRelatedGroups, nonUserRelatedGrantedGroups } = groupGrantData;

    if (userRelatedGroups.length === 0) {
      return (
        <div>
          <h4>{t('user_group.belonging_to_no_group')}</h4>
          { currentUser?.admin && (
            <p><a href="/admin/user-groups"><span className="material-symbols-outlined me-1">login</span>{t('user_group.manage_user_groups')}</a></p>
          ) }
        </div>
      );
    }

    return (
      <div className="d-flex flex-column">
        { userRelatedGroups.map((group) => {
          const isGroupGranted = selectedGrant?.userRelatedGrantedGroups?.some(grantedGroup => getIdForRef(grantedGroup.item) === group.id);
          const cannotGrantGroup = group.status === UserGroupPageGrantStatus.cannotGrant;
          const activeClass = isGroupGranted ? 'active' : '';

          return (
            <button
              className={`btn btn-outline-primary w-100 d-flex justify-content-start mb-3 align-items-center p-3 ${activeClass}`}
              type="button"
              key={group.id}
              onClick={() => groupListItemClickHandler(group)}
              disabled={cannotGrantGroup}
            >
              <span className="align-middle"><input type="checkbox" checked={isGroupGranted} disabled={cannotGrantGroup} /></span>
              <h5 className="d-inline-block ms-3">{group.name}</h5>
              {group.type === GroupType.externalUserGroup && <span className="ms-2 badge badge-pill badge-info">{group.provider}</span>}
              {/* TODO: Replace <div className="small">(TBD) List group members</div> */}
            </button>
          );
        }) }
        { nonUserRelatedGrantedGroups.map((group) => {
          return (
            <button
              className="btn btn-outline-primary w-100 d-flex justify-content-start mb-3 align-items-center p-3 active"
              type="button"
              key={group.id}
              disabled
            >
              <span className="align-middle"><input type="checkbox" checked disabled /></span>
              <h5 className="d-inline-block ms-3">{group.name}</h5>
              {group.type === GroupType.externalUserGroup && <span className="ms-2 badge badge-pill badge-info">{group.provider}</span>}
              {/* TODO: Replace <div className="small">(TBD) List group members</div> */}
            </button>
          );
        }) }
        <button type="button" className="btn btn-primary mt-2 mx-auto" onClick={() => setIsSelectGroupModalShown(false)}>{t('Done')}</button>
      </div>
    );

  }, [currentUser?.admin, groupListItemClickHandler, shouldFetch, t, groupGrantData, selectedGrant?.userRelatedGrantedGroups]);

  return (
    <>
      { renderGrantSelector() }

      {/* render modal */}
      { !disabled && currentUser != null && (
        <Modal
          isOpen={isSelectGroupModalShown}
          toggle={() => setIsSelectGroupModalShown(false)}
          centered
        >
          <ModalHeader tag="h4" toggle={() => setIsSelectGroupModalShown(false)} className="bg-purple text-muted">
            {t('user_group.select_group')}
          </ModalHeader>
          <ModalBody>
            {renderSelectGroupModalContent()}
          </ModalBody>
        </Modal>
      ) }
    </>
  );
};

import React from 'react';
import PropTypes from 'prop-types';
import { withTranslation } from 'react-i18next';
import loggerFactory from '@alias/logger';
import { withUnstatedContainers } from '../UnstatedUtils';


import AppContainer from '../../services/AppContainer';
import PageContainer from '../../services/PageContainer';
import { toastError } from '../../util/apiNotification';

import PaginationWrapper from '../PaginationWrapper';

import Page from '../PageList/Page';

const logger = loggerFactory('growi:MyBookmarkList');
class MyBookmarkList extends React.Component {

  constructor(props) {
    super(props);

    this.state = {
      pages: [],
      activePage: 1,
      totalPages: 0,
      pagingLimit: null,
    };

    this.handlePage = this.handlePage.bind(this);
  }

  componentWillMount() {
    this.getMyBookmarkList(1);
  }

  async handlePage(selectPageNumber) {
    await this.getMyBookmarkList(selectPageNumber);
  }

  async getMyBookmarkList(selectPageNumber) {
    const { appContainer } = this.props;
    const userId = appContainer.currentUserId;
    const page = selectPageNumber;

    try {
      const { data } = await this.props.appContainer.apiv3.get(`/bookmarks/${userId}`, { page });
      if (data.paginationResult == null) {
        throw new Error('data must conclude \'paginateResult\' property.');
      }
      const {
        docs: pages, totalDocs: totalPages, limit: pagingLimit, page: activePage,
      } = data.paginationResult;
      this.setState({
        pages,
        totalPages,
        pagingLimit,
        activePage,
      });
    }
    catch (error) {
      logger.error('failed to fetch data', error);
      toastError(error, 'Error occurred in bookmark page list');
    }
  }

  /**
   * generate Elements of Page
   *
   * @param {any} pages Array of pages Model Obj
   *
   */
  generatePageList(pages) {
    return pages.map(page => (
      <li key={`my-bookmarks:${page._id}`}>
        <Page page={page.page} />
      </li>
    ));
  }

  renderNoBookmarkList = () => {
    const { t } = this.props;
    if (this.state.pages.length === 0) {
      return (
        <div>
          {t('No bookmarks yet')}
        </div>
      );
    }
  }

  renderBookmarkList = () => {
    return (
      <div className="page-list-container-create">
        <ul className="page-list-ul page-list-ul-flat mb-3">
          {this.generatePageList(this.state.pages)}
        </ul>
        <PaginationWrapper
          activePage={this.state.activePage}
          changePage={this.handlePage}
          totalItemsCount={this.state.totalPages}
          pagingLimit={this.state.pagingLimit}
        />
      </div>
    );
  }


  render() {
    return (
      // <div className="page-list-container-create">
      //   <ul className="page-list-ul page-list-ul-flat mb-3">
      //     {this.generatePageList(this.state.pages)}
      //   </ul>
      //   <PaginationWrapper
      //     activePage={this.state.activePage}
      //     changePage={this.handlePage}
      //     totalItemsCount={this.state.totalPages}
      //     pagingLimit={this.state.pagingLimit}
      //   />
      // </div>
      <>
        {this.renderNoBookmarkList()}
        {this.renderBookmarkList()}
      </>
    );
  }

}

/**
 * Wrapper component for using unstated
 */
const MyBookmarkListWrapper = withUnstatedContainers(MyBookmarkList, [AppContainer, PageContainer]);

MyBookmarkList.propTypes = {
  t: PropTypes.func.isRequired,
  appContainer: PropTypes.instanceOf(AppContainer).isRequired,
  pageContainer: PropTypes.instanceOf(PageContainer).isRequired,
};

export default withTranslation()(MyBookmarkListWrapper);

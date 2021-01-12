const mongoose = require('mongoose');
const escapeStringRegexp = require('escape-string-regexp');
const logger = require('@alias/logger')('growi:models:page');
const debug = require('debug')('growi:models:page');
const { Writable } = require('stream');
const { createBatchStream } = require('@server/util/batch-stream');
const { serializePageSecurely } = require('../models/serializers/page-serializer');

const STATUS_PUBLISHED = 'published';
const BULK_REINDEX_SIZE = 100;

class PageService {

  constructor(crowi) {
    this.crowi = crowi;
  }

  async deleteCompletely(pageIds, pagePaths) {
    // Delete Bookmarks, Attachments, Revisions, Pages and emit delete
    const Bookmark = this.crowi.model('Bookmark');
    const Comment = this.crowi.model('Comment');
    const Page = this.crowi.model('Page');
    const PageTagRelation = this.crowi.model('PageTagRelation');
    const ShareLink = this.crowi.model('ShareLink');
    const Revision = this.crowi.model('Revision');

    return Promise.all([
      Bookmark.find({ page: { $in: pageIds } }).remove({}),
      Comment.find({ page: { $in: pageIds } }).remove({}),
      PageTagRelation.find({ relatedPage: { $in: pageIds } }).remove({}),
      ShareLink.find({ relatedPage: { $in: pageIds } }).remove({}),
      Revision.find({ path: { $in: pagePaths } }).remove({}),
      Page.find({ _id: { $in: pageIds } }).remove({}),
      Page.find({ path: { $in: pagePaths } }).remove({}),
      this.removeAllAttachments(pageIds),
    ]);
  }

  async removeAllAttachments(pageIds) {
    const Attachment = this.crowi.model('Attachment');
    const { attachmentService } = this.crowi;
    const attachments = await Attachment.find({ page: { $in: pageIds } });

    return attachmentService.removeAttachment(attachments);
  }

  async duplicate(page, newPagePath, user, isRecursively) {
    const Page = this.crowi.model('Page');
    const PageTagRelation = mongoose.model('PageTagRelation');
    // populate
    await page.populate({ path: 'revision', model: 'Revision', select: 'body' }).execPopulate();

    // create option
    const options = { page };
    options.grant = page.grant;
    options.grantUserGroupId = page.grantedGroup;
    options.grantedUsers = page.grantedUsers;

    const createdPage = await Page.create(
      newPagePath, page.revision.body, user, options,
    );

    if (isRecursively) {
      this.duplicateStream(page, newPagePath, user);
    }

    // take over tags
    const originTags = await page.findRelatedTagsById();
    let savedTags = [];
    if (originTags != null) {
      await PageTagRelation.updatePageTags(createdPage.id, originTags);
      savedTags = await PageTagRelation.listTagNamesByPage(createdPage.id);
    }

    const result = serializePageSecurely(createdPage);
    result.tags = savedTags;

    return result;
  }

  async duplicateDescendants(pages, user, oldPagePathPrefix, newPagePathPrefix, pathRevisionMapping) {
    const Page = this.crowi.model('Page');
    const Revision = this.crowi.model('Revision');
    const PageTagRelation = mongoose.model('PageTagRelation');

    const newPageTagRelation = [];
    const newPages = [];
    const newRevisions = [];

    await Promise.all(pages.map(async(page) => {
      const newPagePath = page.path.replace(oldPagePathPrefix, newPagePathPrefix);
      const pageId = new mongoose.Types.ObjectId();
      const revisionId = new mongoose.Types.ObjectId();

      const pageTagRelations = await PageTagRelation.find({ relatedPage: page._id });
      pageTagRelations.forEach((pageTagRelation) => {
        newPageTagRelation.push({
          relatedPage: pageId,
          relatedTag: pageTagRelation.relatedTag,
        });
      });

      newPages.push({
        _id: pageId,
        path: newPagePath,
        creator: user._id,
        grant: page.grant,
        grantedGroup: page.grantedGroup,
        grantedUsers: page.grantedUsers,
        lastUpdateUser: user._id,
        redirectTo: null,
        revision: revisionId,
      });

      newRevisions.push({
        _id: revisionId, path: newPagePath, body: pathRevisionMapping[page.path].body, author: user._id, format: 'markdown',
      });

    }));

    await PageTagRelation.insertMany(newPageTagRelation, { ordered: false });
    await Page.insertMany(newPages, { ordered: false });
    await Revision.insertMany(newRevisions, { ordered: false });

  }

  async duplicateStream(page, newPagePath, user) {
    const Page = this.crowi.model('Page');
    const Revision = this.crowi.model('Revision');
    const newPagePathPrefix = newPagePath;
    const pathRegExp = new RegExp(`^${escapeStringRegexp(page.path)}`, 'i');
    const revisions = await Revision.find({ path: pathRegExp });

    const { PageQueryBuilder } = Page;

    const readStream = new PageQueryBuilder(Page.find())
      .addConditionToExcludeRedirect()
      .addConditionToListOnlyDescendants(page.path)
      .query
      .lean()
      .cursor();

    // Mapping to set to the body of the new revision
    const pathRevisionMapping = {};
    revisions.forEach((revision) => {
      pathRevisionMapping[revision.path] = revision;
    });

    const duplicateDescendants = this.duplicateDescendants.bind(this);
    let count = 0;
    const writeStream = new Writable({
      objectMode: true,
      async write(batch, encoding, callback) {
        try {
          count += batch.length;
          await duplicateDescendants(batch, user, pathRegExp, newPagePathPrefix, pathRevisionMapping);
          logger.info(`Adding pages progressing: (count=${count})`);
        }
        catch (err) {
          logger.error('addAllPages error on add anyway: ', err);
        }

        callback();
      },
      final(callback) {
        logger.info(`Adding pages has completed: (totalCount=${count})`);

        callback();
      },
    });

    readStream
      .pipe(createBatchStream(BULK_REINDEX_SIZE))
      .pipe(writeStream);

  }

  // delete multiple pages
  async completelyDeletePages(pagesData, user, options = {}) {
    this.validateCrowi();
    let pageEvent;
    // init event
    if (this.crowi != null) {
      pageEvent = this.crowi.event('page');
      pageEvent.on('create', pageEvent.onCreate);
      pageEvent.on('update', pageEvent.onUpdate);
    }

    const ids = pagesData.map(page => (page._id));
    const paths = pagesData.map(page => (page.path));
    const socketClientId = options.socketClientId || null;

    logger.debug('Deleting completely', paths);

    await this.deleteCompletely(ids, paths);

    if (socketClientId != null) {
      pageEvent.emit('deleteCompletely', pagesData, user, socketClientId); // update as renamed page
    }
    return;
  }

  // delete single page completely
  async completelyDeleteSinglePage(pageData, user, options = {}) {
    this.validateCrowi();
    let pageEvent;
    // init event
    if (this.crowi != null) {
      pageEvent = this.crowi.event('page');
      pageEvent.on('create', pageEvent.onCreate);
      pageEvent.on('update', pageEvent.onUpdate);
    }

    const ids = [pageData._id];
    const paths = [pageData.path];
    const socketClientId = options.socketClientId || null;

    logger.debug('Deleting completely', paths);

    await this.deleteCompletely(ids, paths);

    if (socketClientId != null) {
      pageEvent.emit('delete', pageData, user, socketClientId); // update as renamed page
    }
    return;
  }

  /**
   * Delete Bookmarks, Attachments, Revisions, Pages and emit delete
   */
  async completelyDeletePageRecursively(targetPage, user, options = {}) {
    const findOpts = { includeTrashed: true };
    const Page = this.crowi.model('Page');

    // find manageable descendants (this array does not include GRANT_RESTRICTED)
    const pages = await Page.findManageableListWithDescendants(targetPage, user, findOpts);

    // TODO streaming bellow action
    return this.completelyDeletePages(pages, user, options);
  }

  async revertDeletedPageRecursively(targetPage, user, options = {}) {
    const Page = this.crowi.model('Page');
    const findOpts = { includeTrashed: true };
    const pages = await Page.findManageableListWithDescendants(targetPage, user, findOpts);

    let updatedPage = null;
    await Promise.all(pages.map((page) => {
      const isParent = (page.path === targetPage.path);
      const p = this.revertDeletedPages(page, user, options);
      if (isParent) {
        updatedPage = p;
      }
      return p;
    }));

    return updatedPage;
  }

  // revert pages recursively
  async revertDeletedPages(page, user, options = {}) {
    const Page = this.crowi.model('Page');
    const newPath = Page.getRevertDeletedPageName(page.path);
    const originPage = await Page.findByPath(newPath);
    if (originPage != null) {
    // When the page is deleted, it will always be created with "redirectTo" in the path of the original page.
    // So, it's ok to delete the page
    // However, If a page exists that is not "redirectTo", something is wrong. (Data correction is needed).
      if (originPage.redirectTo !== page.path) {
        throw new Error('The new page of to revert is exists and the redirect path of the page is not the deleted page.');
      }
      // originPage is object.
      await this.completelyDeletePages([originPage], options);
    }

    page.status = STATUS_PUBLISHED;
    page.lastUpdateUser = user;
    debug('Revert deleted the page', page, newPath);
    const updatedPage = await Page.rename(page, newPath, user, {});
    return updatedPage;
  }

  async revertSingleDeletedPage(page, user, options = {}) {
    const Page = this.crowi.model('Page');
    const newPath = Page.getRevertDeletedPageName(page.path);
    const originPage = await Page.findByPath(newPath);
    if (originPage != null) {
      // When the page is deleted, it will always be created with "redirectTo" in the path of the original page.
      // So, it's ok to delete the page
      // However, If a page exists that is not "redirectTo", something is wrong. (Data correction is needed).
      if (originPage.redirectTo !== page.path) {
        throw new Error('The new page of to revert is exists and the redirect path of the page is not the deleted page.');
      }
      await this.completelyDeleteSinglePage(originPage, options);
    }

    page.status = STATUS_PUBLISHED;
    page.lastUpdateUser = user;
    debug('Revert deleted the page', page, newPath);
    const updatedPage = await Page.rename(page, newPath, user, {});
    return updatedPage;
  }

  async handlePrivatePagesForDeletedGroup(deletedGroup, action, transferToUserGroupId) {
    const Page = this.crowi.model('Page');
    const pages = await Page.find({ grantedGroup: deletedGroup });

    switch (action) {
      case 'public':
        await Promise.all(pages.map((page) => {
          return Page.publicizePage(page);
        }));
        break;
      case 'delete':
        return this.completelyDeletePages(pages);
      case 'transfer':
        await Promise.all(pages.map((page) => {
          return Page.transferPageToGroup(page, transferToUserGroupId);
        }));
        break;
      default:
        throw new Error('Unknown action for private pages');
    }
  }

  validateCrowi() {
    if (this.crowi == null) {
      throw new Error('"crowi" is null. Init User model with "crowi" argument first.');
    }
  }

}

module.exports = PageService;

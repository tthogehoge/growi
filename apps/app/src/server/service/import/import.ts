import fs from 'fs';
import path from 'path';
import type { EventEmitter } from 'stream';
import { Writable, Transform } from 'stream';

import JSONStream from 'JSONStream';
import gc from 'expose-gc/function';
import type {
  BulkWriteOperationError, BulkWriteResult, ObjectId, UnorderedBulkOperation,
} from 'mongodb';
import mongoose from 'mongoose';
import streamToPromise from 'stream-to-promise';
import unzipStream from 'unzip-stream';

import type Crowi from '~/server/crowi';
import { setupIndependentModels } from '~/server/crowi/setup-models';
import type CollectionProgress from '~/server/models/vo/collection-progress';
import loggerFactory from '~/utils/logger';

import CollectionProgressingStatus from '../../models/vo/collection-progressing-status';
import { createBatchStream } from '../../util/batch-stream';
import { configManager } from '../config-manager';

import type { ConvertMap } from './construct-convert-map';
import { constructConvertMap } from './construct-convert-map';
import { getModelFromCollectionName } from './get-model-from-collection-name';
import { keepOriginal } from './overwrite-function';


const logger = loggerFactory('growi:services:ImportService'); // eslint-disable-line no-unused-vars


const BULK_IMPORT_SIZE = 100;


class ImportingCollectionError extends Error {

  collectionProgress: CollectionProgress;

  constructor(collectionProgress, error) {
    super(error);
    this.collectionProgress = collectionProgress;
  }

}


export class ImportService {

  private crowi: Crowi;

  private growiBridgeService: any;

  private adminEvent: EventEmitter;

  private currentProgressingStatus: CollectionProgressingStatus | null;

  private convertMap: ConvertMap;

  constructor(crowi: Crowi) {
    this.crowi = crowi;
    this.growiBridgeService = crowi.growiBridgeService;
    // this.getFile = this.growiBridgeService.getFile.bind(this);
    // this.baseDir = path.join(crowi.tmpDir, 'imports');

    this.adminEvent = crowi.event('admin');

    this.currentProgressingStatus = null;
  }

  private get baseDir(): string {
    return path.join(this.crowi.tmpDir, 'imports');
  }

  /**
   * parse all zip files in downloads dir
   *
   * @memberOf ExportService
   * @return {object} info for zip files and whether currentProgressingStatus exists
   */
  async getStatus() {
    const zipFiles = fs.readdirSync(this.baseDir).filter(file => path.extname(file) === '.zip');

    // process serially so as not to waste memory
    const zipFileStats: any[] = [];
    const parseZipFilePromises: Promise<any>[] = zipFiles.map((file) => {
      const zipFile = this.growiBridgeService.getFile(file);
      return this.growiBridgeService.parseZipFile(zipFile);
    });
    for await (const stat of parseZipFilePromises) {
      zipFileStats.push(stat);
    }

    // filter null object (broken zip)
    const filtered = zipFileStats
      .filter(zipFileStat => zipFileStat != null);
    // sort with ctime("Change Time" - Time when file status was last changed (inode data modification).)
    filtered.sort((a, b) => { return a.fileStat.ctime - b.fileStat.ctime });

    const zipFileStat = filtered.pop();
    let isTheSameVersion = false;

    if (zipFileStat != null) {
      try {
        this.validate(zipFileStat.meta);
        isTheSameVersion = true;
      }
      catch (err) {
        isTheSameVersion = false;
        logger.error('the versions are not met', err);
      }
    }


    return {
      isTheSameVersion,
      zipFileStat,
      isImporting: this.currentProgressingStatus != null,
      progressList: this.currentProgressingStatus?.progressList ?? null,
    };
  }


  async preImport() {
    await setupIndependentModels();

    // initialize convertMap
    this.convertMap = constructConvertMap();
  }

  /**
   * import collections from json
   *
   * @param {string[]} collections MongoDB collection name
   * @param {{ [collectionName: string]: ImportSettings }} importSettingsMap key: collection name, value: ImportSettings instance
   * @return {Promise<void>}
   */
  async import(collections, importSettingsMap) {
    await this.preImport();

    // init status object
    this.currentProgressingStatus = new CollectionProgressingStatus(collections);

    // process serially so as not to waste memory
    const promises = collections.map((collectionName) => {
      const importSettings = importSettingsMap[collectionName];
      return this.importCollection(collectionName, importSettings);
    });
    for await (const promise of promises) {
      try {
        await promise;
      }
      // catch ImportingCollectionError
      catch (err) {
        const { collectionProgress } = err;
        logger.error(`failed to import to ${collectionProgress.collectionName}`, err);
        this.emitProgressEvent(collectionProgress, { message: err.message });
      }
    }

    this.currentProgressingStatus = null;
    this.emitTerminateEvent();

    await configManager.loadConfigs();

    const currentIsV5Compatible = configManager.getConfig('crowi', 'app:isV5Compatible');
    const isImportPagesCollection = collections.includes('pages');
    const shouldNormalizePages = currentIsV5Compatible && isImportPagesCollection;

    if (shouldNormalizePages) await this.crowi.pageService.normalizeAllPublicPages();
  }

  /**
   * import a collection from json
   *
   * @memberOf ImportService
   * @param {string} collectionName MongoDB collection name
   * @param {ImportSettings} importSettings
   * @return {insertedIds: Array.<string>, failedIds: Array.<string>}
   */
  async importCollection(collectionName, importSettings) {
    if (this.currentProgressingStatus == null) {
      throw new Error('Something went wrong: currentProgressingStatus is not initialized');
    }

    // prepare functions invoked from custom streams
    const convertDocuments = this.convertDocuments.bind(this);
    const bulkOperate = this.bulkOperate.bind(this);
    const execUnorderedBulkOpSafely = this.execUnorderedBulkOpSafely.bind(this);
    const emitProgressEvent = this.emitProgressEvent.bind(this);

    const collection = mongoose.connection.collection(collectionName);

    const { mode, jsonFileName, overwriteParams } = importSettings;
    const collectionProgress = this.currentProgressingStatus.progressMap[collectionName];

    try {
      const jsonFile = this.growiBridgeService.getFile(jsonFileName);

      // validate options
      this.validateImportSettings(collectionName, importSettings);

      // flush
      if (mode === 'flushAndInsert') {
        await collection.deleteMany({});
      }

      // stream 1
      const readStream = fs.createReadStream(jsonFile, { encoding: this.growiBridgeService.getEncoding() });

      // stream 2
      const jsonStream = JSONStream.parse('*');

      // stream 3
      const convertStream = new Transform({
        objectMode: true,
        transform(doc, encoding, callback) {
          const converted = convertDocuments(collectionName, doc, overwriteParams);
          this.push(converted);
          callback();
        },
      });

      // stream 4
      const batchStream = createBatchStream(BULK_IMPORT_SIZE);

      // stream 5
      const writeStream = new Writable({
        objectMode: true,
        async write(batch, encoding, callback) {
          const unorderedBulkOp = collection.initializeUnorderedBulkOp();

          // documents are not persisted until unorderedBulkOp.execute()
          batch.forEach((document) => {
            bulkOperate(unorderedBulkOp, collectionName, document, importSettings);
          });

          // exec
          const { insertedCount, modifiedCount, errors } = await execUnorderedBulkOpSafely(unorderedBulkOp);
          logger.debug(`Importing ${collectionName}. Inserted: ${insertedCount}. Modified: ${modifiedCount}. Failed: ${errors.length}.`);

          const increment = insertedCount + modifiedCount + errors.length;
          collectionProgress.currentCount += increment;
          collectionProgress.totalCount += increment;
          collectionProgress.insertedCount += insertedCount;
          collectionProgress.modifiedCount += modifiedCount;

          emitProgressEvent(collectionProgress, errors);

          try {
            // First aid to prevent unexplained memory leaks
            logger.info('global.gc() invoked.');
            gc();
          }
          catch (err) {
            logger.error('fail garbage collection: ', err);
          }

          callback();
        },
        final(callback) {
          logger.info(`Importing ${collectionName} has completed.`);
          callback();
        },
      });

      readStream
        .pipe(jsonStream)
        .pipe(convertStream)
        .pipe(batchStream)
        .pipe(writeStream);

      await streamToPromise(writeStream);

      // clean up tmp directory
      fs.unlinkSync(jsonFile);
    }
    catch (err) {
      throw new ImportingCollectionError(collectionProgress, err);
    }

  }

  /**
   *
   * @param {string} collectionName
   * @param {importSettings} importSettings
   */
  validateImportSettings(collectionName, importSettings) {
    const { mode } = importSettings;

    switch (collectionName) {
      case 'configs':
        if (mode !== 'flushAndInsert') {
          throw new Error(`The specified mode '${mode}' is not allowed when importing to 'configs' collection.`);
        }
        break;
    }
  }

  /**
   * process bulk operation
   * @param {object} bulk MongoDB Bulk instance
   * @param {string} collectionName collection name
   * @param {object} document
   * @param {ImportSettings} importSettings
   */
  bulkOperate(bulk, collectionName, document, importSettings) {
    // insert
    if (importSettings.mode !== 'upsert') {
      return bulk.insert(document);
    }

    // upsert
    switch (collectionName) {
      case 'pages':
        return bulk.find({ path: document.path }).upsert().replaceOne(document);
      default:
        return bulk.find({ _id: document._id }).upsert().replaceOne(document);
    }
  }

  /**
   * emit progress event
   * @param {CollectionProgress} collectionProgress
   * @param {object} appendedErrors key: collection name, value: array of error object
   */
  emitProgressEvent(collectionProgress, appendedErrors) {
    const { collectionName } = collectionProgress;

    // send event (in progress in global)
    this.adminEvent.emit('onProgressForImport', { collectionName, collectionProgress, appendedErrors });
  }

  /**
   * emit terminate event
   */
  emitTerminateEvent() {
    this.adminEvent.emit('onTerminateForImport');
  }

  /**
   * extract a zip file
   *
   * @memberOf ImportService
   * @param {string} zipFile absolute path to zip file
   * @return {Array.<string>} array of absolute paths to extracted files
   */
  async unzip(zipFile) {
    const readStream = fs.createReadStream(zipFile);
    const unzipStreamPipe = readStream.pipe(unzipStream.Parse());
    const files: string[] = [];

    unzipStreamPipe.on('entry', (/** @type {Entry} */ entry) => {
      const fileName = entry.path;
      // https://regex101.com/r/mD4eZs/6
      // prevent from unexpecting attack doing unzip file (path traversal attack)
      // FOR EXAMPLE
      // ../../src/server/example.html
      if (fileName.match(/(\.\.\/|\.\.\\)/)) {
        logger.error('File path is not appropriate.', fileName);
        return;
      }

      if (fileName === this.growiBridgeService.getMetaFileName()) {
        // skip meta.json
        entry.autodrain();
      }
      else {
        const jsonFile = path.join(this.baseDir, fileName);
        const writeStream = fs.createWriteStream(jsonFile, { encoding: this.growiBridgeService.getEncoding() });
        entry.pipe(writeStream);
        files.push(jsonFile);
      }
    });

    await streamToPromise(unzipStreamPipe);

    return files;
  }

  /**
   * execute unorderedBulkOp and ignore errors
   *
   * @memberOf ImportService
   */
  async execUnorderedBulkOpSafely(unorderedBulkOp: UnorderedBulkOperation): Promise<{ insertedCount: number, modifiedCount: number, errors: unknown[] }> {
    let errors: unknown[] = [];
    let log: BulkWriteResult | null = null;

    try {
      log = await unorderedBulkOp.execute();
    }
    catch (err) {

      const _errs = Array.isArray(err.writeErrors) ? err : [err];

      const errTypeGuard = (err: any): err is BulkWriteOperationError => {
        return 'index' in err;
      };
      const docTypeGuard = (op: any): op is { _id: ObjectId } => {
        return '_id' in op;
      };

      errors = _errs.map((e) => {
        if (errTypeGuard(e)) {
          const { op } = e;
          return {
            _id: docTypeGuard(op) ? op._id : undefined,
            message: err.errmsg,
          };
        }
        return err;
      });
    }

    assert(log != null);
    const insertedCount = log.nInserted + log.nUpserted;
    const modifiedCount = log.nModified;

    return {
      insertedCount,
      modifiedCount,
      errors,
    };

  }

  /**
   * execute unorderedBulkOp and ignore errors
   *
   * @memberOf ImportService
   * @param {string} collectionName
   * @param {object} document document being imported
   * @param {object} overwriteParams overwrite each document with unrelated value. e.g. { creator: req.user }
   * @return {object} document to be persisted
   */
  convertDocuments(collectionName, document, overwriteParams) {
    const Model = getModelFromCollectionName(collectionName);
    const schema = (Model != null) ? Model.schema : undefined;
    const convertMap = this.convertMap[collectionName];

    const _document = {};

    // not Mongoose Model
    if (convertMap == null) {
      // apply keepOriginal to all of properties
      Object.entries(document).forEach(([propertyName, value]) => {
        _document[propertyName] = keepOriginal(value, { document, propertyName });
      });
    }
    // Mongoose Model
    else {
      // assign value from documents being imported
      Object.entries(convertMap).forEach(([propertyName, convertedValue]) => {
        const value = document[propertyName];

        // distinguish between null and undefined
        if (value === undefined) {
          return; // next entry
        }

        const convertFunc = (typeof convertedValue === 'function') ? convertedValue : null;
        _document[propertyName] = (convertFunc != null) ? convertFunc(value, { document, propertyName, schema }) : convertedValue;
      });
    }

    // overwrite documents with custom values
    Object.entries(overwriteParams).forEach(([propertyName, overwriteValue]) => {
      const value = document[propertyName];

      // distinguish between null and undefined
      if (value !== undefined) {
        const overwriteFunc = (typeof overwriteValue === 'function') ? overwriteValue : null;
        _document[propertyName] = (overwriteFunc != null) ? overwriteFunc(value, { document: _document, propertyName, schema }) : overwriteValue;
      }
    });

    return _document;
  }

  /**
   * validate using meta.json
   * to pass validation, all the criteria must be met
   *   - ${version of this GROWI} === ${version of GROWI that exported data}
   *
   * @memberOf ImportService
   * @param {object} meta meta data from meta.json
   */
  validate(meta) {
    if (meta.version !== this.crowi.version) {
      throw new Error('The version of this GROWI and the uploaded GROWI data are not the same');
    }

    // TODO: check if all migrations are completed
    // - export: throw err if there are pending migrations
    // - import: throw err if there are pending migrations
  }

  /**
   * Delete all uploaded files
   */
  deleteAllZipFiles() {
    fs.readdirSync(this.baseDir)
      .filter(file => path.extname(file) === '.zip')
      .forEach(file => fs.unlinkSync(path.join(this.baseDir, file)));
  }

}

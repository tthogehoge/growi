import type { Request, RequestHandler } from 'express';
import type { ValidationChain } from 'express-validator';

import type Crowi from '~/server/crowi';
import { certifyAiService } from '~/server/middlewares/certify-ai-service';
import { configManager } from '~/server/service/config-manager';
import OpenaiClient from '~/server/service/openai-client-delegator';
import loggerFactory from '~/utils/logger';

import { apiV3FormValidator } from '../../../middlewares/apiv3-form-validator';
import type { ApiV3Response } from '../interfaces/apiv3-response';

const logger = loggerFactory('growi:routes:apiv3:ai-integration:rebuild-vector-store');

type RebuildVectorStoreFactory = (crowi: Crowi) => RequestHandler[];

export const rebuildVectorStoreHandlersFactory: RebuildVectorStoreFactory = (crowi) => {
  const accessTokenParser = require('~/server/middlewares/access-token-parser')(crowi);
  const loginRequiredStrictly = require('~/server/middlewares/login-required')(crowi);
  const adminRequired = require('~/server/middlewares/admin-required')(crowi);

  const validator: ValidationChain[] = [
    //
  ];

  return [
    accessTokenParser, loginRequiredStrictly, adminRequired, certifyAiService, validator, apiV3FormValidator,
    async(req: Request, res: ApiV3Response) => {

      const vectorStoreId = configManager.getConfig('crowi', 'app:openaiVectorStoreId');

      const client = new OpenaiClient();

      // Delete an existing VectorStoreFile
      const vectorStoreFileData = await client.getVectorStoreFiles(vectorStoreId);
      const vectorStoreFiles = vectorStoreFileData?.data;
      if (vectorStoreFiles != null && vectorStoreFiles.length > 0) {
        vectorStoreFiles.forEach(async(vectorStoreFile) => {
          await client.deleteVectorStoreFiles(vectorStoreId, vectorStoreFile.id);
        });
      }

      return res.apiv3({});
    },
  ];
};

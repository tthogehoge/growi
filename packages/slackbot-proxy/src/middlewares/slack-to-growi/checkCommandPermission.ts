import {
  IMiddleware, Inject, Middleware, Next, Req, Res,
} from '@tsed/common';
import {
  generateWebClient, markdownSectionBlock, GrowiCommand,
} from '@growi/slack';
import { RelationMock } from '~/entities/relation-mock';

import { RelationsService } from '~/services/RelationsService';
import { InstallerService } from '~/services/InstallerService';
// import { SelectGrowiService } from '~/services/SelectGrowiService';

import { InstallationRepository } from '~/repositories/installation';
import { RelationMockRepository } from '~/repositories/relation-mock';

import { SlackOauthReq } from '~/interfaces/slack-to-growi/slack-oauth-req';


@Middleware()
export class checkCommandPermissionMiddleware implements IMiddleware {

  @Inject()
  installerService: InstallerService;

  @Inject()
  installationRepository: InstallationRepository;

  @Inject()
  relationMockRepository: RelationMockRepository;

  @Inject()
  relationsService: RelationsService;


  async use(@Req() req:SlackOauthReq & Request, @Res() res:Res, @Next() next: Next):Promise<void> {
    const { body, authorizeResult } = req;

    let payload:any;
    let command:string;
    let actionId:string;
    let callbackId:string;
    let growiCommand:GrowiCommand;

    if (body.payload) {
      payload = JSON.parse(req.body.payload);

      console.log(49, payload);
      const privateMeta = JSON.parse(payload.view.private_metadata);

      // first payload
      if (privateMeta.body != null) {
        command = privateMeta.body.text.split(' ')[0];
      }
      // second payload
      else {
        console.log(56, payload.view.callback_id);

        command = payload.view.callback_id!.split(':')[0];
      }
      console.log(37, command);


    }
    else if (body.payload == null) {
      command = body.text.split(' ')[0];
      console.log(command);

    }
    else {
      callbackId = payload.view.callback_id;

    }

    const passCommandArray = ['status', 'register', 'unregister', 'help'];
    console.log(command!);

    if (passCommandArray.includes(command!)) {
      console.log(22);
      return next();
    }

    const installationId = authorizeResult.enterpriseId || authorizeResult.teamId;
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    const installation = await this.installationRepository.findByTeamIdOrEnterpriseId(installationId!);
    const relations = await this.relationMockRepository.createQueryBuilder('relation_mock')
      .where('relation_mock.installationId = :id', { id: installation?.id })
      .leftJoinAndSelect('relation_mock.installation', 'installation')
      .getMany();

    if (relations.length === 0) {
      // return res.json({
      //   blocks: [
      //     markdownSectionBlock('*No relation found.*'),
      //     markdownSectionBlock('Run `/growi register` first.'),
      //   ],
      // });
    }
    // Send response immediately to avoid opelation_timeout error
    // See https://api.slack.com/apis/connections/events-api#the-events-api__responding-to-events
    // res.send();

    const baseDate = new Date();
    // const relationsForSingleUse:RelationMock[] = [];
    await Promise.all(relations.map(async(relation) => {
      const isSupported = await this.relationsService.isSupportedGrowiCommandForSingleUse(relation, command, baseDate);
      if (isSupported) {
        console.log(75);
        return next();
      }
    }));

    // const relationsForBroadcastUse:RelationMock[] = [];
    // check cache
    await Promise.all(relations.map(async(relation) => {
      const isSupported = await this.relationsService.isSupportedGrowiCommandForBroadcastUse(relation, command, baseDate);
      if (isSupported) {
        return next();
      }
    }));

    // check permission at channel level
    const relationMock = await this.relationMockRepository.findOne({ where: { installation } });
    const channelsObject = relationMock?.permittedChannelsForEachCommand.channelsObject;

    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    const permittedCommandsForChannel = Object.keys(channelsObject!); // eg. [ 'create', 'search', 'togetter', ... ]
    console.log(112, permittedCommandsForChannel);


    const targetCommand = permittedCommandsForChannel.find(e => e === command);
    console.log(command!);

    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    console.log(118, targetCommand);


    const permittedChannels = channelsObject![targetCommand!];
    console.log(permittedChannels);

    let fromChannel:string;
    if (body.channel_name != null) {
      fromChannel = body.channel_name;
    }
    else {
      const privateMeta = JSON.parse(payload.view.private_metadata);
      fromChannel = privateMeta.channelName;

    }
    const isPermittedChannel = permittedChannels.includes(fromChannel);

    if (isPermittedChannel) {
      return next();
    }

    // send postEphemral message for not permitted
    const botToken = relations[0].installation?.data.bot?.token;

    console.log(111);

    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    const client = generateWebClient(botToken!);
    await client.chat.postEphemeral({
      text: 'Error occured.',
      channel: body.channel_id,
      user: body.user_id,
      blocks: [
        markdownSectionBlock(`It is not allowed to run *'${command!}'* command to this GROWI.`),
      ],
    });

  }

}

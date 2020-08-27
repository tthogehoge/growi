import React, { Fragment } from 'react';
import { withTranslation } from 'react-i18next';
import PropTypes from 'prop-types';

import AppSetting from './AppSetting';
import SiteUrlSetting from './SiteUrlSetting';
import MailSetting from './MailSetting';
import AwsSetting from './AwsSetting';
import PluginSetting from './PluginSetting';

class AppSettingsPageContents extends React.Component {

  render() {
    const { t } = this.props;

    return (
      <Fragment>
        <div className="row">
          <div className="col-lg-12">
            <h2 className="admin-setting-header">{t('App Settings')}</h2>
            <AppSetting />
          </div>
        </div>

        <div className="row mt-5">
          <div className="col-lg-12">
            <h2 className="admin-setting-header">{t('Site URL settings')}</h2>
            <SiteUrlSetting />
          </div>
        </div>

        <div className="row mt-5">
          <div className="col-lg-12">
            <h2 className="admin-setting-header">{t('admin:app_setting.mail_settings')}</h2>
            <MailSetting />
          </div>
        </div>

        <div className="row mt-5">
          <div className="col-lg-12">
            <h2 className="admin-setting-header">{t('admin:app_setting.gcp_settings')}</h2>
          </div>
        </div>

        <div className="row mt-5">
          <div className="col-lg-12">
            <h2 className="admin-setting-header">{t('admin:app_setting.aws_settings')}</h2>
            <AwsSetting />
          </div>
        </div>

        <div className="row mt-5">
          <div className="col-lg-12">
            <h2 className="admin-setting-header">{t('admin:app_setting.plugin_settings')}</h2>
            <PluginSetting />
          </div>
        </div>
      </Fragment>
    );
  }

}

AppSettingsPageContents.propTypes = {
  t: PropTypes.func.isRequired, // i18next
};

export default withTranslation()(AppSettingsPageContents);

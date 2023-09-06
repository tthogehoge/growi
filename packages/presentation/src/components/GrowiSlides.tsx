import Head from 'next/head';
import { ReactMarkdown } from 'react-markdown/lib/react-markdown';

import type { PresentationOptions } from '../consts';
import { MARP_CONTAINER_CLASS_NAME, marpit } from '../services/growi-marpit';
import * as extractSections from '../services/renderer/extract-sections';

import { RichSlideSection } from './RichSlideSection';


type Props = {
  options: PresentationOptions,
  children?: string,
}

export const GrowiSlides = (props: Props): JSX.Element => {
  const {
    options, children,
  } = props;
  const {
    rendererOptions, isDarkMode, disableSeparationByHeader,
  } = options;

  if (rendererOptions == null || rendererOptions.remarkPlugins == null || rendererOptions.components == null) {
    return <></>;
  }

  rendererOptions.remarkPlugins.push([
    extractSections.remarkPlugin,
    {
      isDarkMode,
      disableSeparationByHeader,
    },
  ]);
  rendererOptions.components.section = RichSlideSection;

  const { css } = marpit.render('');
  return (
    <>
      <Head>
        <style>{css}</style>
      </Head>
      <div className={`slides ${MARP_CONTAINER_CLASS_NAME}`}>
        <ReactMarkdown {...rendererOptions}>
          { children ?? '## No Contents' }
        </ReactMarkdown>
      </div>
    </>
  );

};

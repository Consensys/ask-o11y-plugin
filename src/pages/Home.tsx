import React from 'react';
import { testIds } from '../components/testIds';
import { Chat } from '../components/Chat';
import type { AppPluginSettings } from '../types/plugin';

interface HomeProps {
  pluginSettings: AppPluginSettings;
}

function Home({ pluginSettings }: HomeProps) {
  return (
    <div data-testid={testIds.home.container} className="min-h-full w-full flex flex-col">
      <div className="flex-1 flex flex-col min-h-0">
        <Chat pluginSettings={pluginSettings} />
      </div>
    </div>
  );
}

export default Home;

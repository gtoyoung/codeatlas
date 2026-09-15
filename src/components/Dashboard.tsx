'use client';

import AtlasWorkspace from './AtlasWorkspace';

export default function Dashboard({ suggestedPath }: { suggestedPath: string }) {
  return <AtlasWorkspace suggestedPath={suggestedPath} />;
}

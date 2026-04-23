import { useEffect } from 'react'

import ModuleSidebar from '@/components/ModuleSidebar'
import AnnotationModule from '@/modules/AnnotationModule'
import DatasetModule from '@/modules/DatasetModule'
import ImageProcessingModule from '@/modules/ImageProcessingModule'
import { useAppStore } from '@/stores/appStore'
import { useCurrentRelicStore } from '@/stores/currentRelicStore'

function App() {
  const activeModule = useAppStore((state) => state.activeModule)
  const bootstrap = useCurrentRelicStore((state) => state.bootstrap)
  const loadState = useCurrentRelicStore((state) => state.loadState)

  useEffect(() => {
    if (loadState.kind === 'idle') {
      void bootstrap()
    }
  }, [bootstrap, loadState])

  return (
    <div className="flex min-h-screen">
      <ModuleSidebar />

      <main className="flex min-h-screen flex-1 flex-col overflow-x-hidden">
        {activeModule === 'imageProcessing' ? <ImageProcessingModule /> : null}
        {activeModule === 'annotation' ? <AnnotationModule /> : null}
        {activeModule === 'dataset' ? <DatasetModule /> : null}
      </main>
    </div>
  )
}

export default App

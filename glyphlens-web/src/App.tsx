import ModuleSidebar from '@/components/ModuleSidebar'
import ImageProcessingModule from '@/modules/ImageProcessingModule'
import MultiLayerModule from '@/modules/MultiLayerModule'
import PlaceholderModule from '@/modules/PlaceholderModule'
import { useAppStore } from '@/stores/appStore'

function App() {
  const activeModule = useAppStore((state) => state.activeModule)

  return (
    <div className="flex min-h-screen">
      <ModuleSidebar />

      <main className="flex min-h-screen flex-1 flex-col overflow-x-hidden">
        {activeModule === 'imageProcessing' ? <ImageProcessingModule /> : null}
        {activeModule === 'multiLayer' ? <MultiLayerModule /> : null}
        {activeModule === 'annotation' ? (
          <PlaceholderModule
            title="字迹标注"
            description="后续将接入字迹框选与候选字推荐，支持人工与模型协同完成碑刻释读。该模块依赖图像处理模块产出的线图与拓片。"
            roadmap={[
              '框选 / 多边形工具，支持逐字与批量标注',
              '基于线图与拓片的字形候选检索',
              '与数据管理模块打通的标注版本与作者信息',
            ]}
          />
        ) : null}
        {activeModule === 'dataset' ? (
          <PlaceholderModule
            title="数据管理"
            description="集中管理碑刻原石、拓本、处理产物与标注版本，支持按地域、时代、刻工、材质等多维度浏览与检索。"
            roadmap={[
              'SQLite / PostgreSQL 元数据模型',
              '按碑刻 / 画像石分层组织，支持多源图像上传',
              '处理产物与标注的版本管理与回滚',
            ]}
          />
        ) : null}
      </main>
    </div>
  )
}

export default App

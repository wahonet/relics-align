import { create } from 'zustand'

export type ModuleId =
  | 'imageProcessing'
  | 'multiLayer'
  | 'annotation'
  | 'dataset'

export interface ModuleDescriptor {
  id: ModuleId
  title: string
  available: boolean
}

export const MODULES: ModuleDescriptor[] = [
  { id: 'imageProcessing', title: '图像处理', available: true },
  { id: 'multiLayer', title: '多图层比对', available: true },
  { id: 'annotation', title: '字迹标注', available: false },
  { id: 'dataset', title: '数据管理', available: false },
]

interface AppStore {
  activeModule: ModuleId
  setActiveModule: (moduleId: ModuleId) => void
}

export const useAppStore = create<AppStore>((set) => ({
  activeModule: 'imageProcessing',
  setActiveModule: (moduleId) => {
    const target = MODULES.find((module) => module.id === moduleId)

    if (!target || !target.available) {
      return
    }

    set({ activeModule: moduleId })
  },
}))

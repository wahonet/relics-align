import { create } from 'zustand'

export type ModuleId =
  | 'imageProcessing'
  | 'annotation'
  | 'dataset'

export interface ModuleDescriptor {
  id: ModuleId
  title: string
  available: boolean
}

export const MODULES: ModuleDescriptor[] = [
  { id: 'imageProcessing', title: '图像处理', available: true },
  { id: 'annotation', title: '字迹标注', available: true },
  { id: 'dataset', title: '数据管理', available: true },
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

import { Hourglass } from 'lucide-react'

interface PlaceholderModuleProps {
  title: string
  description: string
  roadmap: string[]
}

export default function PlaceholderModule({
  title,
  description,
  roadmap,
}: PlaceholderModuleProps) {
  return (
    <div className="flex min-h-full items-start justify-center py-16">
      <div className="max-w-2xl rounded-3xl border border-paper-300/70 bg-paper-50/90 p-10 shadow-[0_20px_50px_-30px_rgba(35,26,15,0.55)]">
        <div className="flex items-center gap-3">
          <span className="flex h-10 w-10 items-center justify-center rounded-full border border-ochre-500/60 bg-ochre-400/15 text-ochre-600">
            <Hourglass className="h-4 w-4" />
          </span>
          <div>
            <p className="text-[11px] uppercase tracking-[0.35em] text-ink-300">Coming Soon</p>
            <h2 className="font-display text-2xl text-ink-600">{title}</h2>
          </div>
        </div>

        <p className="mt-5 text-sm leading-6 text-ink-400">{description}</p>

        <div className="mt-6 border-t border-paper-300/70 pt-5">
          <p className="text-xs uppercase tracking-[0.3em] text-ink-300">规划的能力</p>
          <ul className="mt-3 space-y-2 text-sm text-ink-500">
            {roadmap.map((item) => (
              <li key={item} className="flex gap-3">
                <span className="mt-[8px] h-[5px] w-[5px] shrink-0 rounded-full bg-ochre-500" />
                <span>{item}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  )
}

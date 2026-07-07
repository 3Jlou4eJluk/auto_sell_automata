import { useEffect, useRef, type ComponentType } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import {
  DockviewComponent,
  type DockviewApi,
  type DockviewComponentOptions,
  type DockviewReadyEvent,
  type GroupPanelPartInitParameters,
  type IContentRenderer,
  type IDockviewPanelProps,
} from 'dockview'

export type DockviewPanelComponent = ComponentType<IDockviewPanelProps>

interface DockviewReactProps {
  className?: string
  components: Record<string, DockviewPanelComponent>
  onReady?: (event: DockviewReadyEvent) => void
  options?: Partial<DockviewComponentOptions>
}

class ReactContentRenderer implements IContentRenderer {
  readonly element = document.createElement('div')
  private root: Root | null = null
  private params: GroupPanelPartInitParameters | null = null
  private readonly componentName: string
  private readonly componentsRef: React.MutableRefObject<
    Record<string, DockviewPanelComponent>
  >

  constructor(
    componentName: string,
    componentsRef: React.MutableRefObject<
      Record<string, DockviewPanelComponent>
    >,
  ) {
    this.componentName = componentName
    this.componentsRef = componentsRef
    this.element.className = 'dockview-react-panel'
  }

  init(params: GroupPanelPartInitParameters): void {
    this.params = params
    this.root = createRoot(this.element)
    this.render()
  }

  update(): void {
    this.render()
  }

  layout(): void {
    this.render()
  }

  dispose(): void {
    // Dockview может уничтожать панель посреди рендера React —
    // синхронный unmount в этот момент запрещён, откладываем на макротаск.
    const root = this.root
    this.root = null
    if (root) {
      window.setTimeout(() => root.unmount(), 0)
    }
  }

  private render(): void {
    if (!this.root || !this.params) {
      return
    }

    const Component = this.componentsRef.current[this.componentName]

    if (!Component) {
      this.root.render(
        <div className="dockview-missing-panel">
          Неизвестная панель: {this.componentName}
        </div>,
      )
      return
    }

    this.root.render(<Component {...this.params} />)
  }
}

export function DockviewReact({
  className,
  components,
  onReady,
  options,
}: DockviewReactProps) {
  const hostRef = useRef<HTMLDivElement | null>(null)
  const componentsRef = useRef(components)
  const onReadyRef = useRef(onReady)
  const optionsRef = useRef(options)
  const apiRef = useRef<DockviewApi | null>(null)

  componentsRef.current = components
  onReadyRef.current = onReady
  optionsRef.current = options

  useEffect(() => {
    const host = hostRef.current

    if (!host) {
      return undefined
    }

    const dockview = new DockviewComponent(host, {
      ...(optionsRef.current ?? {}),
      createComponent: ({ name }) =>
        new ReactContentRenderer(name, componentsRef),
    })

    apiRef.current = dockview.api
    onReadyRef.current?.({ api: dockview.api })

    return () => {
      apiRef.current = null
      dockview.dispose()
    }
  }, [])

  useEffect(() => {
    apiRef.current?.updateOptions(options ?? {})
  }, [options])

  return <div ref={hostRef} className={className} />
}

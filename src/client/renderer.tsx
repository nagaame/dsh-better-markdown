import { memo, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import MarkdownRender, { MarkdownCodeBlockNode } from 'markstream-react'
import type { NodeComponentProps } from 'markstream-react'
import type { CodeBlockNode, ImageNode, InlineCodeNode, LinkNode } from 'stream-markdown-parser'
import { DisclosureRow, IconThinkOutline14, JsonBlock } from '@deepseek-ai/dsh-client-ui-primitives'
import type { MarkdownFileMentions } from '@deepseek-ai/dsh-client-ui-primitives'
import { ImageGallery } from '@deepseek-ai/dsh-client-ui-attachment'
import type { ImageLoader } from '@deepseek-ai/dsh-client-ui-attachment'
import type {
  AssistantChatData, ChatNodeViewProps, ChatViewSlotProps, TurnTailOwnerProps,
} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import { SHIKI_LANGUAGES } from './shiki.ts'

const CUSTOM_COMPONENT_SCOPE = 'dsh-better-markdown'

function isFileMentions(value: unknown): value is MarkdownFileMentions {
  return typeof value === 'object' && value !== null && 'resolve' in value
    && typeof value.resolve === 'function'
}

function rendererFileMentions(ctx: NodeComponentProps['ctx']): MarkdownFileMentions | undefined {
  const value = ctx?.codeBlockProps?.fileMentions
  return isFileMentions(value) ? value : undefined
}

function safeLink(url: string): string | undefined {
  try {
    const protocol = new URL(url).protocol
    return protocol === 'http:' || protocol === 'https:' || protocol === 'mailto:' ? url : undefined
  } catch {
    return undefined
  }
}

function remoteImage(url: string): string | undefined {
  const safe = safeLink(url)
  return safe?.startsWith('http:') || safe?.startsWith('https:') ? safe : undefined
}

/** Preserve DSH's external-only Markdown image policy. */
export function DshImageNode({ node }: NodeComponentProps<ImageNode>) {
  const src = remoteImage(node.src)
  if (src === undefined) return <span className="dsh-better-markdown__image-alt">{node.alt}</span>
  return <img className="dsh-better-markdown__image" src={src} alt={node.alt} title={node.title ?? undefined} referrerPolicy="no-referrer" />
}

/** Preserve safe external links while leaving relative and unsafe targets inert. */
export function DshLinkNode({ node, children }: NodeComponentProps<LinkNode>) {
  const href = safeLink(node.href)
  if (href === undefined) return <>{children ?? node.text}</>
  return <a href={href} target="_blank" rel="noopener noreferrer">{children ?? node.text}</a>
}

/** Preserve DSH's URL promotion and settled file-mention behavior for inline code. */
export function DshInlineCodeNode({ node, ctx }: NodeComponentProps<InlineCodeNode>) {
  const href = safeLink(node.code)
  if (href?.startsWith('http:') || href?.startsWith('https:')) {
    return <code><a href={href} target="_blank" rel="noopener noreferrer">{node.code}</a></code>
  }
  const mention = rendererFileMentions(ctx)?.resolve(node.code)
  if (mention !== undefined) {
    return (
      <code>
        <button
          type="button"
          className="dsh-better-markdown__file-mention"
          title={mention.title}
          aria-label={mention.label}
          onClick={mention.open}
        >
          {node.code}
        </button>
      </code>
    )
  }
  return <code>{node.code}</code>
}

/** Use Markstream's worker-free Shiki renderer for fenced code blocks. */
export function DshCodeBlockNode({ node, ctx }: NodeComponentProps<CodeBlockNode>) {
  return (
    <MarkdownCodeBlockNode
      node={node}
      loading={node.loading}
      stream={ctx?.codeBlockStream ?? true}
      isDark={ctx?.isDark ?? false}
      langs={SHIKI_LANGUAGES}
      onCopy={ctx?.events.onCopy}
    />
  )
}

/** Markstream wrapper configured for untrusted assistant output. */
export const MarkstreamMarkdown = memo(function MarkstreamMarkdown({ text, streaming, fileMentions }: {
  text: string
  streaming: boolean
  fileMentions?: MarkdownFileMentions | undefined
}) {
  const codeBlockProps = useMemo(() => ({
    fileMentions: streaming ? undefined : fileMentions,
  }), [fileMentions, streaming])
  return (
    <div className="dsh-better-markdown__markdown" data-markdown-renderer="markstream-react">
      <MarkdownRender
        content={text}
        final={!streaming}
        customId={CUSTOM_COMPONENT_SCOPE}
        htmlPolicy="escape"
        fade={false}
        smoothStreaming={false}
        viewportPriority={false}
        codeBlockStream={streaming}
        codeBlockProps={codeBlockProps}
      />
    </div>
  )
})

function firstLine(text: string): string {
  const newline = text.indexOf('\n')
  return newline === -1 ? text : text.slice(0, newline)
}

function latestLine(text: string): string {
  const visible = text.trimEnd()
  const newline = visible.lastIndexOf('\n')
  return newline === -1 ? visible : visible.slice(newline + 1)
}

function ReasoningRow({ text, running, t }: {
  text: string
  running: boolean
  t: ChatViewSlotProps['t']
}) {
  const [expanded, setExpanded] = useState(false)
  const summaryRef = useRef<HTMLSpanElement>(null)
  const summary = running ? latestLine(text) : firstLine(text)
  useEffect(() => {
    const element = summaryRef.current
    if (element !== null) element.scrollLeft = running ? element.scrollWidth - element.clientWidth : 0
  }, [running, summary])
  return (
    <div className="dsh-better-markdown__reasoning" data-state={running ? 'running' : 'ok'}>
      {running && <span className="dsh-better-markdown__visually-hidden">{t('row.running')}</span>}
      <DisclosureRow
        rowClassName="dsh-better-markdown__reasoning-row"
        leadingClassName="dsh-better-markdown__reasoning-leading"
        titleClassName="dsh-better-markdown__reasoning-title"
        chevronClassName="dsh-better-markdown__reasoning-chevron"
        icon={<IconThinkOutline14 size={14} />}
        title="Think"
        open={expanded}
        expandable
        expandOnRowClick
        onToggle={() => { setExpanded(value => !value) }}
        collapsedContent={(
          <>
            <span className="dsh-better-markdown__reasoning-separator" aria-hidden />
            <span ref={summaryRef} className="dsh-better-markdown__reasoning-summary">{summary}</span>
          </>
        )}
      >
        <div className="dsh-better-markdown__reasoning-body">{text}</div>
      </DisclosureRow>
    </div>
  )
}

type AssistantBlock = AssistantChatData['blocks'][number]

function BetterAssistantMarkdown({ blocks, streaming, interrupted, loadImage, mentions, t }: {
  blocks: readonly AssistantBlock[]
  streaming: boolean
  interrupted?: boolean | undefined
  loadImage?: ImageLoader | undefined
  mentions?: MarkdownFileMentions | undefined
  t: ChatViewSlotProps['t']
}) {
  const imageLoader = loadImage ?? (() => Promise.reject(new Error(t('image.serviceUnavailable'))))
  const last = blocks.length - 1
  const hasVisible = streaming || interrupted === true || blocks.some(block => block.kind !== 'tool-call')
  if (!hasVisible) return null
  const rendered: ReactNode[] = []
  for (let index = 0; index < blocks.length; index += 1) {
    const block = blocks[index]
    if (block === undefined) continue
    switch (block.kind) {
      case 'text':
        rendered.push(
          <MarkstreamMarkdown key={index} text={block.text} streaming={streaming} fileMentions={mentions} />,
        )
        break
      case 'reasoning':
        rendered.push(<ReasoningRow key={index} text={block.text} running={streaming && index === last} t={t} />)
        break
      case 'image': {
        const start = index
        const group = [block]
        while (index + 1 < blocks.length) {
          const next = blocks[index + 1]
          if (next === undefined || next.kind !== 'image') break
          group.push(next)
          index += 1
        }
        rendered.push(
          <ImageGallery
            key={start}
            images={group}
            load={imageLoader}
            align="start"
            labels={{
              image: t('image.label'),
              open: t('image.openOriginal'),
              openNamed: label => t('image.openOriginalLabel', { label }),
              loading: t('image.loading'),
              loadFailed: t('image.loadFailed'),
              lightbox: {
                dialog: t('image.preview'),
                close: t('image.closePreview'),
              },
            }}
          />,
        )
        break
      }
      case 'tool-call':
        break
      default:
        rendered.push(
          <JsonBlock
            key={index}
            label={t('message.unknownBlock')}
            payload={block.block}
            truncatedLabel={total => t('json.truncated', { total })}
          />,
        )
    }
  }
  return (
    <div className="dsh-better-markdown__root" data-streaming={streaming || undefined}>
      <div className="dsh-better-markdown__body">
        {rendered}
        {interrupted && <span className="dsh-better-markdown__stopped">{t('message.stopped')}</span>}
      </div>
    </div>
  )
}

/** Streaming, settled, and interrupted assistant states rendered through Markstream. */
export const BetterAssistantNodeView = memo(function BetterAssistantNodeView({
  node, useTurnData, openFile, loadImage, fileMentions, t,
}: ChatNodeViewProps<'assistant-step'>) {
  const data = node.data
  const turn = node.location.kind === 'turn' || node.location.kind === 'step'
    ? node.location.turn
    : undefined
  const tail = useTurnData('turn-tail')
  const owner = useMemo<TurnTailOwnerProps | undefined>(() => {
    if (turn?.status !== 'closed' || data.finalNode === undefined) return undefined
    if (tail?.closing?.finalNode.seq !== data.finalNode.seq) return undefined
    return { turn, seq: data.finalNode.seq, openFile }
  }, [data.finalNode, openFile, tail, turn])
  const mentions = useMemo(
    () => owner === undefined ? undefined : fileMentions(owner),
    [fileMentions, owner],
  )
  return (
    <BetterAssistantMarkdown
      blocks={data.blocks}
      streaming={data.status === 'running'}
      interrupted={data.status === 'interrupted'}
      loadImage={loadImage}
      mentions={mentions}
      t={t}
    />
  )
})

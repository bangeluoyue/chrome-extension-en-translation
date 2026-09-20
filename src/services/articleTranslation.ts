import type { UserConfig } from '../types'
import { splitMarkdownIntoSegments } from '../lib/markdownSegmenter'
import { translateProtectedMarkdownStream } from './protectedMarkdownTranslation'

export interface ArticleTranslationResume {
  segmentCount: number
  completedSegments: readonly string[]
}

export interface ArticleTranslationProgress {
  phase: 'translating' | 'completed'
  currentSegment: number
  segmentCount: number
  completedSegmentCount: number
  completedSegments: readonly string[]
}

export interface ArticleTranslationOptions {
  signal?: AbortSignal
  resume?: ArticleTranslationResume | null
  onProgress?: (
    progress: ArticleTranslationProgress,
  ) => void | Promise<void>
}

export interface ArticleTranslationRun {
  stream: AsyncGenerator<string>
  initialMarkdown: string
  segmentCount: number
  completedSegmentCount: number
  resumeAccepted: boolean
}

export function createArticleTranslationRun(
  markdown: string,
  config: UserConfig,
  options: ArticleTranslationOptions = {},
): ArticleTranslationRun {
  const segments = splitMarkdownIntoSegments(markdown)
  const resumeAccepted = isValidResume(options.resume, segments.length)
  const completedSegments = resumeAccepted
    ? [...(options.resume?.completedSegments ?? [])]
    : []

  return {
    stream: translateSegments(segments, completedSegments, config, options),
    initialMarkdown: joinTranslatedSegments(completedSegments),
    segmentCount: segments.length,
    completedSegmentCount: completedSegments.length,
    resumeAccepted,
  }
}

async function* translateSegments(
  segments: string[],
  initialCompletedSegments: string[],
  config: UserConfig,
  options: ArticleTranslationOptions,
): AsyncGenerator<string> {
  const { signal, onProgress } = options
  const completedSegments = [...initialCompletedSegments]

  for (
    let segmentIndex = completedSegments.length;
    segmentIndex < segments.length;
    segmentIndex += 1
  ) {
    if (signal?.aborted) {
      return
    }

    await notifyProgress(onProgress, {
      phase: 'translating',
      currentSegment: segmentIndex + 1,
      segmentCount: segments.length,
      completedSegmentCount: completedSegments.length,
      completedSegments: [...completedSegments],
    })

    let hasTranslatedContent = false
    let segmentStarted = false
    let translatedSegment = ''

    for await (const chunk of translateProtectedMarkdownStream(
      segments[segmentIndex],
      config,
      signal,
    )) {
      if (signal?.aborted) {
        return
      }

      if (!segmentStarted && completedSegments.length > 0) {
        yield '\n\n'
      }

      segmentStarted = true
      hasTranslatedContent ||= Boolean(chunk.trim())
      translatedSegment += chunk
      yield chunk
    }

    if (signal?.aborted) {
      return
    }

    if (!hasTranslatedContent) {
      throw new Error('翻译服务未返回内容')
    }

    completedSegments.push(translatedSegment)
    await notifyProgress(onProgress, {
      phase: 'completed',
      currentSegment: segmentIndex + 1,
      segmentCount: segments.length,
      completedSegmentCount: completedSegments.length,
      completedSegments: [...completedSegments],
    })
  }
}

function isValidResume(
  resume: ArticleTranslationResume | null | undefined,
  segmentCount: number,
): resume is ArticleTranslationResume {
  return Boolean(
    resume &&
      resume.segmentCount === segmentCount &&
      resume.completedSegments.length <= segmentCount &&
      resume.completedSegments.every((segment) => Boolean(segment.trim())),
  )
}

function joinTranslatedSegments(segments: readonly string[]): string {
  return segments.join('\n\n')
}

async function notifyProgress(
  onProgress: ArticleTranslationOptions['onProgress'],
  progress: ArticleTranslationProgress,
): Promise<void> {
  await onProgress?.(progress)
}

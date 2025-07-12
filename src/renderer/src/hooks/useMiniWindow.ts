import { fetchChatCompletion } from '@renderer/services/ApiService'
import { getDefaultTopic } from '@renderer/services/AssistantService'
import { getAssistantMessage, getUserMessage } from '@renderer/services/MessagesService'
import store, { useAppDispatch, useAppSelector } from '@renderer/store'
import { updateOneBlock, upsertManyBlocks, upsertOneBlock } from '@renderer/store/messageBlock'
import { newMessagesActions, selectMessagesForTopic } from '@renderer/store/newMessage'
import { setMiniWindowClipboardText, setMiniWindowRoute, setMiniWindowUserInputText } from '@renderer/store/runtime'
import { Assistant, MiniWindowRoute, Topic } from '@renderer/types'
import { Chunk, ChunkType } from '@renderer/types/chunk'
import { AssistantMessageStatus, MessageBlockStatus } from '@renderer/types/newMessage'
import { abortCompletion } from '@renderer/utils/abortController'
import { isAbortError } from '@renderer/utils/error'
import { createMainTextBlock, createThinkingBlock } from '@renderer/utils/messageUtils/create'
import { isEmpty } from 'lodash'
import { RefObject, useCallback, useMemo, useState } from 'react'

export interface SendMessageOptions {
  assistant: Assistant
  topicRef: RefObject<Topic>
  askIdRef: RefObject<string>
}

const getReferenceText = (userInputText: string, clipboardText: string) => {
  return clipboardText || userInputText
}

const getUserContent = (isFirstMessage: boolean, userInputText: string, referenceText: string) => {
  if (isFirstMessage) {
    return referenceText === userInputText ? userInputText : `${referenceText}\n\n${userInputText}`.trim()
  }
  return userInputText.trim()
}

export const useMiniWindow = () => {
  const route = useAppSelector((state) => state.runtime.miniWindow.route)
  const userInputText = useAppSelector((state) => state.runtime.miniWindow.userInputText)
  const clipboardText = useAppSelector((state) => state.runtime.miniWindow.clipboardText)
  const dispatch = useAppDispatch()

  const [isFirstMessage, setIsFirstMessage] = useState(true)

  const referenceText = useMemo(() => {
    return getReferenceText(userInputText, clipboardText)
  }, [userInputText, clipboardText])

  const userContent = useMemo(() => {
    return getUserContent(isFirstMessage, userInputText, getReferenceText(userInputText, clipboardText))
  }, [isFirstMessage, userInputText, clipboardText])

  return {
    route,
    userInputText,
    clipboardText,
    isFirstMessage,
    referenceText,
    userContent,
    setIsFirstMessage,
    setRoute: (value: MiniWindowRoute) => {
      dispatch(setMiniWindowRoute(value))
    },
    setUserInputText: (value: string) => {
      dispatch(setMiniWindowUserInputText(value))
    },
    setClipboardText: (value: string) => {
      dispatch(setMiniWindowClipboardText(value))
    }
  }
}

export const useSendMessage = (options: SendMessageOptions) => {
  const { assistant, topicRef, askIdRef } = options

  // Indicator for loading(thinking/streaming)
  const [isLoading, setIsLoading] = useState(false)
  // Indicator for whether the first message is outputted
  const [isOutputted, setIsOutputted] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const { isFirstMessage, setRoute, setUserInputText, setIsFirstMessage } = useMiniWindow()

  const sendMessage = useCallback(
    async (prompt?: string) => {
      const { userInputText, clipboardText } = store.getState().runtime.miniWindow
      const topic = topicRef.current

      const userContent = getUserContent(isFirstMessage, userInputText, getReferenceText(userInputText, clipboardText))

      if (isEmpty(userContent) || !topic) {
        return
      }

      try {
        const topicId = topic.id

        const { message: userMessage, blocks } = getUserMessage({
          content: [prompt, userContent].filter(Boolean).join('\n\n'),
          assistant,
          topic
        })

        store.dispatch(newMessagesActions.addMessage({ topicId, message: userMessage }))
        store.dispatch(upsertManyBlocks(blocks))

        const assistantMessage = getAssistantMessage({
          assistant,
          topic
        })
        assistantMessage.askId = userMessage.id
        askIdRef.current = userMessage.id

        store.dispatch(newMessagesActions.addMessage({ topicId, message: assistantMessage }))

        const allMessagesForTopic = selectMessagesForTopic(store.getState(), topicId)
        const userMessageIndex = allMessagesForTopic.findIndex((m) => m?.id === userMessage.id)

        const messagesForContext = allMessagesForTopic
          .slice(0, userMessageIndex + 1)
          .filter((m) => m && !m.status?.includes('ing'))

        let blockId: string | null = null
        let blockContent: string = ''
        let thinkingBlockId: string | null = null
        let thinkingBlockContent: string = ''

        setIsLoading(true)
        setIsOutputted(false)
        setError(null)

        setIsFirstMessage(false)
        setUserInputText('')

        await fetchChatCompletion({
          messages: messagesForContext,
          assistant: { ...assistant, settings: { streamOutput: true } },
          onChunkReceived: (chunk: Chunk) => {
            switch (chunk.type) {
              case ChunkType.THINKING_DELTA:
                {
                  thinkingBlockContent += chunk.text
                  setIsOutputted(true)
                  if (!thinkingBlockId) {
                    const block = createThinkingBlock(assistantMessage.id, chunk.text, {
                      status: MessageBlockStatus.STREAMING,
                      thinking_millsec: chunk.thinking_millsec
                    })
                    thinkingBlockId = block.id
                    store.dispatch(
                      newMessagesActions.updateMessage({
                        topicId,
                        messageId: assistantMessage.id,
                        updates: { blockInstruction: { id: block.id } }
                      })
                    )
                    store.dispatch(upsertOneBlock(block))
                  } else {
                    store.dispatch(
                      updateOneBlock({
                        id: thinkingBlockId,
                        changes: { content: thinkingBlockContent, thinking_millsec: chunk.thinking_millsec }
                      })
                    )
                  }
                }
                break
              case ChunkType.THINKING_COMPLETE:
                {
                  if (thinkingBlockId) {
                    store.dispatch(
                      updateOneBlock({
                        id: thinkingBlockId,
                        changes: { status: MessageBlockStatus.SUCCESS, thinking_millsec: chunk.thinking_millsec }
                      })
                    )
                  }
                }
                break
              case ChunkType.TEXT_DELTA:
                {
                  blockContent += chunk.text
                  setIsOutputted(true)
                  if (!blockId) {
                    const block = createMainTextBlock(assistantMessage.id, chunk.text, {
                      status: MessageBlockStatus.STREAMING
                    })
                    blockId = block.id
                    store.dispatch(
                      newMessagesActions.updateMessage({
                        topicId,
                        messageId: assistantMessage.id,
                        updates: { blockInstruction: { id: block.id } }
                      })
                    )
                    store.dispatch(upsertOneBlock(block))
                  } else {
                    store.dispatch(updateOneBlock({ id: blockId, changes: { content: blockContent } }))
                  }
                }
                break
              case ChunkType.TEXT_COMPLETE:
                {
                  blockId &&
                    store.dispatch(updateOneBlock({ id: blockId, changes: { status: MessageBlockStatus.SUCCESS } }))
                  store.dispatch(
                    newMessagesActions.updateMessage({
                      topicId,
                      messageId: assistantMessage.id,
                      updates: { status: AssistantMessageStatus.SUCCESS }
                    })
                  )
                }
                break
              case ChunkType.ERROR: {
                //stop the thinking timer
                const isAborted = isAbortError(chunk.error)
                const possibleBlockId = thinkingBlockId || blockId
                if (possibleBlockId) {
                  store.dispatch(
                    updateOneBlock({
                      id: possibleBlockId,
                      changes: {
                        status: isAborted ? MessageBlockStatus.PAUSED : MessageBlockStatus.ERROR
                      }
                    })
                  )
                }
                if (!isAborted) {
                  throw new Error(chunk.error.message)
                }
              }
              //fall through
              case ChunkType.BLOCK_COMPLETE:
                setIsLoading(false)
                setIsOutputted(true)
                askIdRef.current = ''
                break
            }
          }
        })
      } catch (err) {
        if (isAbortError(err)) return

        setIsLoading(false)
        setError(err instanceof Error ? err.message : 'An error occurred')

        console.error('Error fetching result:', err)
      } finally {
        setIsLoading(false)
        setIsOutputted(true)
        askIdRef.current = ''
      }
    },
    [topicRef, assistant, askIdRef, isFirstMessage, setIsFirstMessage, setUserInputText]
  )

  const pause = useCallback(() => {
    if (!askIdRef.current) return

    abortCompletion(askIdRef.current)
    setIsLoading(false)
    setIsOutputted(true)
    askIdRef.current = ''
  }, [askIdRef])

  const reset = useCallback(() => {
    // Clear the topic messages to reduce memory usage
    if (topicRef.current) {
      store.dispatch(newMessagesActions.clearTopicMessages(topicRef.current.id))
    }

    // Reset the topic
    topicRef.current = getDefaultTopic(assistant.id)

    setError(null)
    setRoute('home')
    setUserInputText('')
    setIsFirstMessage(true)
  }, [topicRef, assistant, setRoute, setUserInputText, setIsFirstMessage])

  return {
    isLoading,
    isOutputted,
    error,
    sendMessage,
    pause,
    reset
  }
}

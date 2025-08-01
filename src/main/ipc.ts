import fs from 'node:fs'
import { arch } from 'node:os'
import path from 'node:path'

import { isLinux, isMac, isWin } from '@main/constant'
import { getBinaryPath, isBinaryExists, runInstallScript } from '@main/utils/process'
import { handleZoomFactor } from '@main/utils/zoom'
import { UpgradeChannel } from '@shared/config/constant'
import { IpcChannel } from '@shared/IpcChannel'
import { ExternalControlServerType, FileMetadata, Provider, Shortcut, ThemeMode } from '@types'
import { BrowserWindow, dialog, ipcMain, session, shell, systemPreferences, webContents } from 'electron'
import log from 'electron-log'
import { Notification } from 'src/renderer/src/types/notification'

import appService from './services/AppService'
import AppUpdater from './services/AppUpdater'
import BackupManager from './services/BackupManager'
import { configManager } from './services/ConfigManager'
import CopilotService from './services/CopilotService'
import DxtService from './services/DxtService'
import { ExportService } from './services/ExportService'
import FileStorage from './services/FileStorage'
import FileService from './services/FileSystemService'
import KnowledgeService from './services/KnowledgeService'
import mcpService from './services/MCPService'
import MemoryService from './services/memory/MemoryService'
import NotificationService from './services/NotificationService'
import * as NutstoreService from './services/NutstoreService'
import ObsidianVaultService from './services/ObsidianVaultService'
import { ProxyConfig, proxyManager } from './services/ProxyManager'
import { pythonService } from './services/PythonService'
import { FileServiceManager } from './services/remotefile/FileServiceManager'
import { searchService } from './services/SearchService'
import { SelectionService } from './services/SelectionService'
import { registerShortcuts, unregisterAllShortcuts } from './services/ShortcutService'
import storeSyncService from './services/StoreSyncService'
import { themeService } from './services/ThemeService'
import VertexAIService from './services/VertexAIService'
import { setOpenLinkExternal } from './services/WebviewService'
import { windowService } from './services/WindowService'
import { calculateDirectorySize, getResourcePath } from './utils'
import { decrypt, encrypt } from './utils/aes'
import { getCacheDir, getConfigDir, getFilesDir, hasWritePermission, updateAppDataConfig } from './utils/file'
import { compress, decompress } from './utils/zip'

const fileManager = new FileStorage()
const backupManager = new BackupManager()
const exportService = new ExportService(fileManager)
const obsidianVaultService = new ObsidianVaultService()
const vertexAIService = VertexAIService.getInstance()
const memoryService = MemoryService.getInstance()
const dxtService = new DxtService()

export function registerIpc(mainWindow: BrowserWindow, app: Electron.App) {
  const appUpdater = new AppUpdater(mainWindow)
  const notificationService = new NotificationService(mainWindow)

  // Initialize Python service with main window
  pythonService.setMainWindow(mainWindow)

  ipcMain.handle(IpcChannel.App_Info, () => ({
    version: app.getVersion(),
    isPackaged: app.isPackaged,
    appPath: app.getAppPath(),
    filesPath: getFilesDir(),
    configPath: getConfigDir(),
    appDataPath: app.getPath('userData'),
    resourcesPath: getResourcePath(),
    logsPath: log.transports.file.getFile().path,
    arch: arch(),
    isPortable: isWin && 'PORTABLE_EXECUTABLE_DIR' in process.env,
    installPath: path.dirname(app.getPath('exe'))
  }))

  ipcMain.handle(IpcChannel.App_Proxy, async (_, proxy: string) => {
    let proxyConfig: ProxyConfig

    if (proxy === 'system') {
      proxyConfig = { mode: 'system' }
    } else if (proxy) {
      proxyConfig = { mode: 'custom', url: proxy }
    } else {
      proxyConfig = { mode: 'none' }
    }

    await proxyManager.configureProxy(proxyConfig)
  })

  ipcMain.handle(IpcChannel.App_Reload, () => mainWindow.reload())
  ipcMain.handle(IpcChannel.Open_Website, (_, url: string) => shell.openExternal(url))

  // Update
  ipcMain.handle(IpcChannel.App_ShowUpdateDialog, () => appUpdater.showUpdateDialog(mainWindow))

  // language
  ipcMain.handle(IpcChannel.App_SetLanguage, (_, language) => {
    configManager.setLanguage(language)
  })

  // spell check
  ipcMain.handle(IpcChannel.App_SetEnableSpellCheck, (_, isEnable: boolean) => {
    // disable spell check for all webviews
    const webviews = webContents.getAllWebContents()
    webviews.forEach((webview) => {
      webview.session.setSpellCheckerEnabled(isEnable)
    })
  })

  // spell check languages
  ipcMain.handle(IpcChannel.App_SetSpellCheckLanguages, (_, languages: string[]) => {
    if (languages.length === 0) {
      return
    }
    const windows = BrowserWindow.getAllWindows()
    windows.forEach((window) => {
      window.webContents.session.setSpellCheckerLanguages(languages)
    })
    configManager.set('spellCheckLanguages', languages)
  })

  // launch on boot
  ipcMain.handle(IpcChannel.App_SetLaunchOnBoot, (_, isLaunchOnBoot: boolean) => {
    appService.setAppLaunchOnBoot(isLaunchOnBoot)
  })

  // launch to tray
  ipcMain.handle(IpcChannel.App_SetLaunchToTray, (_, isActive: boolean) => {
    configManager.setLaunchToTray(isActive)
  })

  // tray
  ipcMain.handle(IpcChannel.App_SetTray, (_, isActive: boolean) => {
    configManager.setTray(isActive)
  })

  // to tray on close
  ipcMain.handle(IpcChannel.App_SetTrayOnClose, (_, isActive: boolean) => {
    configManager.setTrayOnClose(isActive)
  })

  // auto update
  ipcMain.handle(IpcChannel.App_SetAutoUpdate, (_, isActive: boolean) => {
    appUpdater.setAutoUpdate(isActive)
    configManager.setAutoUpdate(isActive)
  })

  ipcMain.handle(IpcChannel.App_SetTestPlan, async (_, isActive: boolean) => {
    log.info('set test plan', isActive)
    if (isActive !== configManager.getTestPlan()) {
      appUpdater.cancelDownload()
      configManager.setTestPlan(isActive)
    }
  })

  ipcMain.handle(IpcChannel.App_SetTestChannel, async (_, channel: UpgradeChannel) => {
    log.info('set test channel', channel)
    if (channel !== configManager.getTestChannel()) {
      appUpdater.cancelDownload()
      configManager.setTestChannel(channel)
    }
  })

  //only for mac
  if (isMac) {
    ipcMain.handle(IpcChannel.App_MacIsProcessTrusted, (): boolean => {
      return systemPreferences.isTrustedAccessibilityClient(false)
    })

    //return is only the current state, not the new state
    ipcMain.handle(IpcChannel.App_MacRequestProcessTrust, (): boolean => {
      return systemPreferences.isTrustedAccessibilityClient(true)
    })
  }

  ipcMain.handle(IpcChannel.Config_Set, (_, key: string, value: any, isNotify: boolean = false) => {
    configManager.set(key, value, isNotify)
  })

  ipcMain.handle(IpcChannel.Config_Get, (_, key: string) => {
    return configManager.get(key)
  })

  // theme
  ipcMain.handle(IpcChannel.App_SetTheme, (_, theme: ThemeMode) => {
    themeService.setTheme(theme)
  })

  ipcMain.handle(IpcChannel.App_HandleZoomFactor, (_, delta: number, reset: boolean = false) => {
    const windows = BrowserWindow.getAllWindows()
    handleZoomFactor(windows, delta, reset)
    return configManager.getZoomFactor()
  })

  // clear cache
  ipcMain.handle(IpcChannel.App_ClearCache, async () => {
    const sessions = [session.defaultSession, session.fromPartition('persist:webview')]

    try {
      await Promise.all(
        sessions.map(async (session) => {
          await session.clearCache()
          await session.clearStorageData({
            storages: ['cookies', 'filesystem', 'shadercache', 'websql', 'serviceworkers', 'cachestorage']
          })
        })
      )
      await fileManager.clearTemp()
      await fs.writeFileSync(log.transports.file.getFile().path, '')
      return { success: true }
    } catch (error: any) {
      log.error('Failed to clear cache:', error)
      return { success: false, error: error.message }
    }
  })

  // get cache size
  ipcMain.handle(IpcChannel.App_GetCacheSize, async () => {
    const cachePath = getCacheDir()
    log.info(`Calculating cache size for path: ${cachePath}`)

    try {
      const sizeInBytes = await calculateDirectorySize(cachePath)
      const sizeInMB = (sizeInBytes / (1024 * 1024)).toFixed(2)
      return `${sizeInMB}`
    } catch (error: any) {
      log.error(`Failed to calculate cache size for ${cachePath}: ${error.message}`)
      return '0'
    }
  })

  let preventQuitListener: ((event: Electron.Event) => void) | null = null
  ipcMain.handle(IpcChannel.App_SetStopQuitApp, (_, stop: boolean = false, reason: string = '') => {
    if (stop) {
      // Only add listener if not already added
      if (!preventQuitListener) {
        preventQuitListener = (event: Electron.Event) => {
          event.preventDefault()
          notificationService.sendNotification({
            title: reason,
            message: reason
          } as Notification)
        }
        app.on('before-quit', preventQuitListener)
      }
    } else {
      // Remove listener if it exists
      if (preventQuitListener) {
        app.removeListener('before-quit', preventQuitListener)
        preventQuitListener = null
      }
    }
  })

  // Select app data path
  ipcMain.handle(IpcChannel.App_Select, async (_, options: Electron.OpenDialogOptions) => {
    try {
      const { canceled, filePaths } = await dialog.showOpenDialog(options)
      if (canceled || filePaths.length === 0) {
        return null
      }
      return filePaths[0]
    } catch (error: any) {
      log.error('Failed to select app data path:', error)
      return null
    }
  })

  ipcMain.handle(IpcChannel.App_HasWritePermission, async (_, filePath: string) => {
    return hasWritePermission(filePath)
  })

  // Set app data path
  ipcMain.handle(IpcChannel.App_SetAppDataPath, async (_, filePath: string) => {
    updateAppDataConfig(filePath)
    app.setPath('userData', filePath)
  })

  ipcMain.handle(IpcChannel.App_GetDataPathFromArgs, () => {
    return process.argv
      .slice(1)
      .find((arg) => arg.startsWith('--new-data-path='))
      ?.split('--new-data-path=')[1]
  })

  ipcMain.handle(IpcChannel.App_FlushAppData, () => {
    BrowserWindow.getAllWindows().forEach((w) => {
      w.webContents.session.flushStorageData()
      w.webContents.session.cookies.flushStore()

      w.webContents.session.closeAllConnections()
    })

    session.defaultSession.flushStorageData()
    session.defaultSession.cookies.flushStore()
    session.defaultSession.closeAllConnections()
  })

  ipcMain.handle(IpcChannel.App_IsNotEmptyDir, async (_, path: string) => {
    return fs.readdirSync(path).length > 0
  })

  // Copy user data to new location
  ipcMain.handle(IpcChannel.App_Copy, async (_, oldPath: string, newPath: string, occupiedDirs: string[] = []) => {
    try {
      await fs.promises.cp(oldPath, newPath, {
        recursive: true,
        filter: (src) => {
          if (occupiedDirs.some((dir) => src.startsWith(path.resolve(dir)))) {
            return false
          }
          return true
        }
      })
      return { success: true }
    } catch (error: any) {
      log.error('Failed to copy user data:', error)
      return { success: false, error: error.message }
    }
  })

  // Relaunch app
  ipcMain.handle(IpcChannel.App_RelaunchApp, (_, options?: Electron.RelaunchOptions) => {
    // Fix for .AppImage
    if (isLinux && process.env.APPIMAGE) {
      log.info('Relaunching app with options:', process.env.APPIMAGE, options)
      // On Linux, we need to use the APPIMAGE environment variable to relaunch
      // https://github.com/electron-userland/electron-builder/issues/1727#issuecomment-769896927
      options = options || {}
      options.execPath = process.env.APPIMAGE
      options.args = options.args || []
      options.args.unshift('--appimage-extract-and-run')
    }

    app.relaunch(options)
    app.exit(0)
  })

  // check for update
  ipcMain.handle(IpcChannel.App_CheckForUpdate, async () => {
    return await appUpdater.checkForUpdates()
  })

  // notification
  ipcMain.handle(IpcChannel.Notification_Send, async (_, notification: Notification) => {
    await notificationService.sendNotification(notification)
  })
  ipcMain.handle(IpcChannel.Notification_OnClick, (_, notification: Notification) => {
    mainWindow.webContents.send('notification-click', notification)
  })

  // zip
  ipcMain.handle(IpcChannel.Zip_Compress, (_, text: string) => compress(text))
  ipcMain.handle(IpcChannel.Zip_Decompress, (_, text: Buffer) => decompress(text))

  // system
  ipcMain.handle(IpcChannel.System_GetDeviceType, () => (isMac ? 'mac' : isWin ? 'windows' : 'linux'))
  ipcMain.handle(IpcChannel.System_GetHostname, () => require('os').hostname())
  ipcMain.handle(IpcChannel.System_ToggleDevTools, (e) => {
    const win = BrowserWindow.fromWebContents(e.sender)
    win && win.webContents.toggleDevTools()
  })

  // backup
  ipcMain.handle(IpcChannel.Backup_Backup, backupManager.backup)
  ipcMain.handle(IpcChannel.Backup_Restore, backupManager.restore)
  ipcMain.handle(IpcChannel.Backup_BackupToWebdav, backupManager.backupToWebdav)
  ipcMain.handle(IpcChannel.Backup_RestoreFromWebdav, backupManager.restoreFromWebdav)
  ipcMain.handle(IpcChannel.Backup_ListWebdavFiles, backupManager.listWebdavFiles)
  ipcMain.handle(IpcChannel.Backup_CheckConnection, backupManager.checkConnection)
  ipcMain.handle(IpcChannel.Backup_CreateDirectory, backupManager.createDirectory)
  ipcMain.handle(IpcChannel.Backup_DeleteWebdavFile, backupManager.deleteWebdavFile)
  ipcMain.handle(IpcChannel.Backup_BackupToLocalDir, backupManager.backupToLocalDir)
  ipcMain.handle(IpcChannel.Backup_RestoreFromLocalBackup, backupManager.restoreFromLocalBackup)
  ipcMain.handle(IpcChannel.Backup_ListLocalBackupFiles, backupManager.listLocalBackupFiles)
  ipcMain.handle(IpcChannel.Backup_DeleteLocalBackupFile, backupManager.deleteLocalBackupFile)
  ipcMain.handle(IpcChannel.Backup_SetLocalBackupDir, backupManager.setLocalBackupDir)
  ipcMain.handle(IpcChannel.Backup_BackupToS3, backupManager.backupToS3)
  ipcMain.handle(IpcChannel.Backup_RestoreFromS3, backupManager.restoreFromS3)
  ipcMain.handle(IpcChannel.Backup_ListS3Files, backupManager.listS3Files)
  ipcMain.handle(IpcChannel.Backup_DeleteS3File, backupManager.deleteS3File)
  ipcMain.handle(IpcChannel.Backup_CheckS3Connection, backupManager.checkS3Connection)

  // file
  ipcMain.handle(IpcChannel.File_Open, fileManager.open)
  ipcMain.handle(IpcChannel.File_OpenPath, fileManager.openPath)
  ipcMain.handle(IpcChannel.File_Save, fileManager.save)
  ipcMain.handle(IpcChannel.File_Select, fileManager.selectFile)
  ipcMain.handle(IpcChannel.File_Upload, fileManager.uploadFile)
  ipcMain.handle(IpcChannel.File_Clear, fileManager.clear)
  ipcMain.handle(IpcChannel.File_Read, fileManager.readFile)
  ipcMain.handle(IpcChannel.File_Delete, fileManager.deleteFile)
  ipcMain.handle('file:deleteDir', fileManager.deleteDir)
  ipcMain.handle(IpcChannel.File_Get, fileManager.getFile)
  ipcMain.handle(IpcChannel.File_SelectFolder, fileManager.selectFolder)
  ipcMain.handle(IpcChannel.File_CreateTempFile, fileManager.createTempFile)
  ipcMain.handle(IpcChannel.File_Write, fileManager.writeFile)
  ipcMain.handle(IpcChannel.File_WriteWithId, fileManager.writeFileWithId)
  ipcMain.handle(IpcChannel.File_SaveImage, fileManager.saveImage)
  ipcMain.handle(IpcChannel.File_Base64Image, fileManager.base64Image)
  ipcMain.handle(IpcChannel.File_SaveBase64Image, fileManager.saveBase64Image)
  ipcMain.handle(IpcChannel.File_Base64File, fileManager.base64File)
  ipcMain.handle(IpcChannel.File_GetPdfInfo, fileManager.pdfPageCount)
  ipcMain.handle(IpcChannel.File_Download, fileManager.downloadFile)
  ipcMain.handle(IpcChannel.File_Copy, fileManager.copyFile)
  ipcMain.handle(IpcChannel.File_BinaryImage, fileManager.binaryImage)
  ipcMain.handle(IpcChannel.File_OpenWithRelativePath, fileManager.openFileWithRelativePath)

  // file service
  ipcMain.handle(IpcChannel.FileService_Upload, async (_, provider: Provider, file: FileMetadata) => {
    const service = FileServiceManager.getInstance().getService(provider)
    return await service.uploadFile(file)
  })

  ipcMain.handle(IpcChannel.FileService_List, async (_, provider: Provider) => {
    const service = FileServiceManager.getInstance().getService(provider)
    return await service.listFiles()
  })

  ipcMain.handle(IpcChannel.FileService_Delete, async (_, provider: Provider, fileId: string) => {
    const service = FileServiceManager.getInstance().getService(provider)
    return await service.deleteFile(fileId)
  })

  ipcMain.handle(IpcChannel.FileService_Retrieve, async (_, provider: Provider, fileId: string) => {
    const service = FileServiceManager.getInstance().getService(provider)
    return await service.retrieveFile(fileId)
  })

  // fs
  ipcMain.handle(IpcChannel.Fs_Read, FileService.readFile)

  // export
  ipcMain.handle(IpcChannel.Export_Word, exportService.exportToWord)

  // open path
  ipcMain.handle(IpcChannel.Open_Path, async (_, path: string) => {
    await shell.openPath(path)
  })

  // shortcuts
  ipcMain.handle(IpcChannel.Shortcuts_Update, (_, shortcuts: Shortcut[]) => {
    configManager.setShortcuts(shortcuts)
    // Refresh shortcuts registration
    if (mainWindow) {
      unregisterAllShortcuts()
      registerShortcuts(mainWindow)
    }
  })

  ipcMain.handle(IpcChannel.ExternalControl_SetServerType, (_, serverType: ExternalControlServerType) => {
    configManager.setExternalControlServerType(serverType)
  })
  ipcMain.handle(IpcChannel.ExternalControl_SetHttpPort, (_, port: number | undefined) => {
    configManager.setExternalControlHttpPort(port)
  })

  // knowledge base
  ipcMain.handle(IpcChannel.KnowledgeBase_Create, KnowledgeService.create)
  ipcMain.handle(IpcChannel.KnowledgeBase_Reset, KnowledgeService.reset)
  ipcMain.handle(IpcChannel.KnowledgeBase_Delete, KnowledgeService.delete)
  ipcMain.handle(IpcChannel.KnowledgeBase_Add, KnowledgeService.add)
  ipcMain.handle(IpcChannel.KnowledgeBase_Remove, KnowledgeService.remove)
  ipcMain.handle(IpcChannel.KnowledgeBase_Search, KnowledgeService.search)
  ipcMain.handle(IpcChannel.KnowledgeBase_Rerank, KnowledgeService.rerank)
  ipcMain.handle(IpcChannel.KnowledgeBase_Check_Quota, KnowledgeService.checkQuota)

  // memory
  ipcMain.handle(IpcChannel.Memory_Add, async (_, messages, config) => {
    return await memoryService.add(messages, config)
  })
  ipcMain.handle(IpcChannel.Memory_Search, async (_, query, config) => {
    return await memoryService.search(query, config)
  })
  ipcMain.handle(IpcChannel.Memory_List, async (_, config) => {
    return await memoryService.list(config)
  })
  ipcMain.handle(IpcChannel.Memory_Delete, async (_, id) => {
    return await memoryService.delete(id)
  })
  ipcMain.handle(IpcChannel.Memory_Update, async (_, id, memory, metadata) => {
    return await memoryService.update(id, memory, metadata)
  })
  ipcMain.handle(IpcChannel.Memory_Get, async (_, memoryId) => {
    return await memoryService.get(memoryId)
  })
  ipcMain.handle(IpcChannel.Memory_SetConfig, async (_, config) => {
    memoryService.setConfig(config)
  })
  ipcMain.handle(IpcChannel.Memory_DeleteUser, async (_, userId) => {
    return await memoryService.deleteUser(userId)
  })
  ipcMain.handle(IpcChannel.Memory_DeleteAllMemoriesForUser, async (_, userId) => {
    return await memoryService.deleteAllMemoriesForUser(userId)
  })
  ipcMain.handle(IpcChannel.Memory_GetUsersList, async () => {
    return await memoryService.getUsersList()
  })

  // window
  ipcMain.handle(IpcChannel.Windows_SetMinimumSize, (_, width: number, height: number) => {
    mainWindow?.setMinimumSize(width, height)
  })

  ipcMain.handle(IpcChannel.Windows_ResetMinimumSize, () => {
    mainWindow?.setMinimumSize(1080, 600)
    const [width, height] = mainWindow?.getSize() ?? [1080, 600]
    if (width < 1080) {
      mainWindow?.setSize(1080, height)
    }
  })

  // VertexAI
  ipcMain.handle(IpcChannel.VertexAI_GetAuthHeaders, async (_, params) => {
    return vertexAIService.getAuthHeaders(params)
  })

  ipcMain.handle(IpcChannel.VertexAI_ClearAuthCache, async (_, projectId: string, clientEmail?: string) => {
    vertexAIService.clearAuthCache(projectId, clientEmail)
  })

  // mini window
  ipcMain.handle(IpcChannel.MiniWindow_Show, () => windowService.showMiniWindow())
  ipcMain.handle(IpcChannel.MiniWindow_Hide, () => windowService.hideMiniWindow())
  ipcMain.handle(IpcChannel.MiniWindow_Close, () => windowService.closeMiniWindow())
  ipcMain.handle(IpcChannel.MiniWindow_Toggle, () => windowService.toggleMiniWindow())
  ipcMain.handle(IpcChannel.MiniWindow_SetPin, (_, isPinned) => windowService.setPinMiniWindow(isPinned))

  // aes
  ipcMain.handle(IpcChannel.Aes_Encrypt, (_, text: string, secretKey: string, iv: string) =>
    encrypt(text, secretKey, iv)
  )
  ipcMain.handle(IpcChannel.Aes_Decrypt, (_, encryptedData: string, iv: string, secretKey: string) =>
    decrypt(encryptedData, iv, secretKey)
  )

  // Register MCP handlers
  ipcMain.handle(IpcChannel.Mcp_RemoveServer, mcpService.removeServer)
  ipcMain.handle(IpcChannel.Mcp_RestartServer, mcpService.restartServer)
  ipcMain.handle(IpcChannel.Mcp_StopServer, mcpService.stopServer)
  ipcMain.handle(IpcChannel.Mcp_ListTools, mcpService.listTools)
  ipcMain.handle(IpcChannel.Mcp_CallTool, mcpService.callTool)
  ipcMain.handle(IpcChannel.Mcp_ListPrompts, mcpService.listPrompts)
  ipcMain.handle(IpcChannel.Mcp_GetPrompt, mcpService.getPrompt)
  ipcMain.handle(IpcChannel.Mcp_ListResources, mcpService.listResources)
  ipcMain.handle(IpcChannel.Mcp_GetResource, mcpService.getResource)
  ipcMain.handle(IpcChannel.Mcp_GetInstallInfo, mcpService.getInstallInfo)
  ipcMain.handle(IpcChannel.Mcp_CheckConnectivity, mcpService.checkMcpConnectivity)
  ipcMain.handle(IpcChannel.Mcp_AbortTool, mcpService.abortTool)
  ipcMain.handle(IpcChannel.Mcp_GetServerVersion, mcpService.getServerVersion)
  ipcMain.handle(IpcChannel.Mcp_SetProgress, (_, progress: number) => {
    mainWindow.webContents.send('mcp-progress', progress)
  })

  // DXT upload handler
  ipcMain.handle(IpcChannel.Mcp_UploadDxt, async (event, fileBuffer: ArrayBuffer, fileName: string) => {
    try {
      // Create a temporary file with the uploaded content
      const tempPath = await fileManager.createTempFile(event, fileName)
      await fileManager.writeFile(event, tempPath, Buffer.from(fileBuffer))

      // Process DXT file using the temporary path
      return await dxtService.uploadDxt(event, tempPath)
    } catch (error) {
      log.error('[IPC] DXT upload error:', error)
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to upload DXT file'
      }
    }
  })

  // Register Python execution handler
  ipcMain.handle(
    IpcChannel.Python_Execute,
    async (_, script: string, context?: Record<string, any>, timeout?: number) => {
      return await pythonService.executeScript(script, context, timeout)
    }
  )

  ipcMain.handle(IpcChannel.App_IsBinaryExist, (_, name: string) => isBinaryExists(name))
  ipcMain.handle(IpcChannel.App_GetBinaryPath, (_, name: string) => getBinaryPath(name))
  ipcMain.handle(IpcChannel.App_InstallUvBinary, () => runInstallScript('install-uv.js'))
  ipcMain.handle(IpcChannel.App_InstallBunBinary, () => runInstallScript('install-bun.js'))

  //copilot
  ipcMain.handle(IpcChannel.Copilot_GetAuthMessage, CopilotService.getAuthMessage)
  ipcMain.handle(IpcChannel.Copilot_GetCopilotToken, CopilotService.getCopilotToken)
  ipcMain.handle(IpcChannel.Copilot_SaveCopilotToken, CopilotService.saveCopilotToken)
  ipcMain.handle(IpcChannel.Copilot_GetToken, CopilotService.getToken)
  ipcMain.handle(IpcChannel.Copilot_Logout, CopilotService.logout)
  ipcMain.handle(IpcChannel.Copilot_GetUser, CopilotService.getUser)

  // Obsidian service
  ipcMain.handle(IpcChannel.Obsidian_GetVaults, () => {
    return obsidianVaultService.getVaults()
  })

  ipcMain.handle(IpcChannel.Obsidian_GetFiles, (_event, vaultName) => {
    return obsidianVaultService.getFilesByVaultName(vaultName)
  })

  // nutstore
  ipcMain.handle(IpcChannel.Nutstore_GetSsoUrl, NutstoreService.getNutstoreSSOUrl)
  ipcMain.handle(IpcChannel.Nutstore_DecryptToken, (_, token: string) => NutstoreService.decryptToken(token))
  ipcMain.handle(IpcChannel.Nutstore_GetDirectoryContents, (_, token: string, path: string) =>
    NutstoreService.getDirectoryContents(token, path)
  )

  // search window
  ipcMain.handle(IpcChannel.SearchWindow_Open, async (_, uid: string) => {
    await searchService.openSearchWindow(uid)
  })
  ipcMain.handle(IpcChannel.SearchWindow_Close, async (_, uid: string) => {
    await searchService.closeSearchWindow(uid)
  })
  ipcMain.handle(IpcChannel.SearchWindow_OpenUrl, async (_, uid: string, url: string) => {
    return await searchService.openUrlInSearchWindow(uid, url)
  })

  // webview
  ipcMain.handle(IpcChannel.Webview_SetOpenLinkExternal, (_, webviewId: number, isExternal: boolean) =>
    setOpenLinkExternal(webviewId, isExternal)
  )

  ipcMain.handle(IpcChannel.Webview_SetSpellCheckEnabled, (_, webviewId: number, isEnable: boolean) => {
    const webview = webContents.fromId(webviewId)
    if (!webview) return
    webview.session.setSpellCheckerEnabled(isEnable)
  })

  // store sync
  storeSyncService.registerIpcHandler()

  // selection assistant
  SelectionService.registerIpcHandler()

  ipcMain.handle(IpcChannel.App_QuoteToMain, (_, text: string) => windowService.quoteToMainWindow(text))

  ipcMain.handle(IpcChannel.App_SetDisableHardwareAcceleration, (_, isDisable: boolean) => {
    configManager.setDisableHardwareAcceleration(isDisable)
  })
}

// Bilingual UI chrome for the popup and the toolbar buttons. The
// dictionary CONTENT stays English (WordNet) — users who want
// non-English content build their own .snplg via the Prong B
// converter — but the surrounding labels, the plugin name, and the
// button names render in the user's locale.
//
// Locale detection: try Intl.Collator's resolved locale (works in
// modern Hermes / JSC), fall back to en. The detected locale is
// resolved once at module load and reused — locale doesn't change
// during a plugin session.
//
// Strings the user actually sees:
//   - The plugin name on the plugin manager card (driven by
//     PluginConfig.json's `name` field, which the firmware parses
//     as a JSON-encoded {locale: string} map; see Sticker plugin
//     for a working precedent).
//   - The button label in the lasso / DOC selection toolbar
//     (driven by registerButton's `button.name`, same JSON-encoded
//     map convention).
//   - The popup labels: "Synonyms", "OCR", "No definition found
//     for", "Close".

export type StringId =
  | 'popup.synonyms'
  | 'popup.ocr'
  | 'popup.notFoundFor'
  | 'popup.close'
  | 'popup.loading'
  | 'popup.recognizing'
  | 'popup.fontSmaller'
  | 'popup.fontLarger'
  | 'popup.pronunciation'
  | 'popup.definition'
  | 'popup.thesaurus'
  | 'popup.antonyms'
  | 'popup.noThesaurus'
  | 'popup.lookUp'
  | 'popup.editOcr'
  | 'popup.addDefinition'
  | 'popup.headword'
  | 'popup.definitionBody'
  | 'popup.save'
  | 'popup.addEmptyError'
  | 'popup.addFailedError'
  | 'popup.copy'
  | 'popup.copied'
  | 'popup.copyFailed'
  | 'settings.open'
  | 'settings.title'
  | 'settings.back'
  | 'settings.save'
  | 'settings.saved'
  | 'settings.saveFailed'
  | 'settings.dictionaries'
  | 'settings.moveUp'
  | 'settings.moveDown'
  | 'settings.enableDict'
  | 'settings.disableDict'
  | 'settings.allDisabled'
  | 'settings.sources'
  | 'settings.keepSources'
  | 'settings.keepSourcesHint'
  | 'settings.keepPrompt'
  | 'settings.removeDict'
  | 'settings.deleteDictPrompt'
  | 'settings.export'
  | 'settings.exportFolder'
  | 'settings.newFolder'
  | 'settings.exportNoSpace'
  | 'settings.exportDone'
  | 'settings.restore'
  | 'settings.restorePrompt'
  | 'settings.restoreDone'
  | 'settings.restoreReopen'
  | 'settings.restoreNoBackup'
  | 'settings.restoreSnapshotFailed'
  | 'common.keep'
  | 'common.delete'
  | 'common.cancel';

// Locale codes use the firmware's convention: en, zh_CN, zh_TW, ja,
// th, nl. Underscore (not hyphen) matches PluginButton.nameMap shape
// observed in logcat for sibling plugins.
const STRINGS: Record<string, Partial<Record<StringId, string>>> = {
  en: {
    'popup.synonyms': 'Synonyms',
    'popup.ocr': 'OCR',
    'popup.notFoundFor': 'No definition found for',
    'popup.close': 'Close',
    'popup.loading': 'Loading…',
    'popup.recognizing': 'Recognizing…',
    'popup.fontSmaller': 'Decrease text size',
    'popup.fontLarger': 'Increase text size',
    'popup.pronunciation': 'Pronunciation',
    'popup.definition': 'Definition',
    'popup.thesaurus': 'Thesaurus',
    'popup.antonyms': 'Antonyms',
    'popup.noThesaurus': 'No synonyms or antonyms available.',
    'popup.lookUp': 'Look up',
    'popup.editOcr': 'Edit recognized text',
    'popup.addDefinition': 'Add definition',
    'popup.headword': 'Headword',
    'popup.definitionBody': 'Definition',
    'popup.save': 'Save',
    'popup.addEmptyError': 'Enter a headword and a definition.',
    'popup.addFailedError': 'Could not save — please try again.',
    'popup.copy': 'Copy',
    'popup.copied': 'Copied',
    'popup.copyFailed': "Couldn't copy",
    'settings.open': 'Settings',
    'settings.title': 'Settings',
    'settings.back': 'Back',
    'settings.save': 'Save',
    'settings.saved': 'Settings saved',
    'settings.saveFailed': "Couldn't save settings",
    'settings.dictionaries': 'Dictionaries',
    'settings.moveUp': 'Move up',
    'settings.moveDown': 'Move down',
    'settings.enableDict': 'Enable',
    'settings.disableDict': 'Disable',
    'settings.allDisabled': 'All dictionaries are off — lookups return nothing.',
    'settings.sources': 'Import sources',
    'settings.keepSources': 'Keep source files after import',
    'settings.keepSourcesHint':
      'When off, sideloaded files are deleted after a verified import.',
    'settings.keepPrompt':
      'Keep the dropped dictionary files after importing? Choose Delete to remove them once the dictionary is built.',
    'settings.removeDict': 'Remove',
    'settings.deleteDictPrompt':
      'Remove this dictionary? Its database and any leftover source files are deleted; it will not reappear on reload.',
    'settings.export': 'Export dictionaries',
    'settings.exportFolder': 'Use this folder',
    'settings.newFolder': 'New folder',
    'settings.exportNoSpace': 'Not enough free space to export — nothing was copied.',
    'settings.exportDone': 'Export complete',
    'settings.restore': 'Restore from here',
    'settings.restorePrompt':
      'Restore from this backup? This replaces your current dictionaries and saved words.',
    'settings.restoreDone': 'Restored',
    'settings.restoreReopen': 'reopen the plugin to finish',
    'settings.restoreNoBackup': 'No dictionary backups found in this folder.',
    'settings.restoreSnapshotFailed':
      "Couldn't save a safety backup — nothing was changed.",
    'common.keep': 'Keep',
    'common.delete': 'Delete',
    'common.cancel': 'Cancel',
  },
  zh_CN: {
    'popup.synonyms': '同义词',
    'popup.ocr': '识别',
    'popup.notFoundFor': '未找到定义：',
    'popup.close': '关闭',
    'popup.loading': '加载中…',
    'popup.recognizing': '识别中…',
    'popup.fontSmaller': '缩小文字',
    'popup.fontLarger': '放大文字',
    'popup.pronunciation': '发音',
    'popup.definition': '释义',
    'popup.thesaurus': '词库',
    'popup.antonyms': '反义词',
    'popup.noThesaurus': '暂无同义词或反义词。',
    'popup.lookUp': '查询',
    'popup.editOcr': '编辑识别文字',
    'popup.addDefinition': '添加释义',
    'popup.headword': '词条',
    'popup.definitionBody': '释义',
    'popup.save': '保存',
    'popup.addEmptyError': '请输入词条和释义。',
    'popup.addFailedError': '保存失败，请重试。',
    'popup.copy': '复制',
    'popup.copied': '已复制',
    'popup.copyFailed': '复制失败',
    'settings.open': '设置',
    'settings.title': '设置',
    'settings.back': '返回',
    'settings.save': '保存',
    'settings.saved': '设置已保存',
    'settings.saveFailed': '无法保存设置',
    'settings.dictionaries': '词典',
    'settings.moveUp': '上移',
    'settings.moveDown': '下移',
    'settings.enableDict': '启用',
    'settings.disableDict': '停用',
    'settings.allDisabled': '所有词典均已关闭——查询将无结果。',
    'settings.sources': '导入源文件',
    'settings.keepSources': '导入后保留源文件',
    'settings.keepSourcesHint': '关闭时，验证导入后将删除侧载文件。',
    'settings.keepPrompt': '导入后保留拖入的词典文件吗？选择“删除”可在词典构建完成后移除它们。',
    'settings.removeDict': '移除',
    'settings.deleteDictPrompt':
      '要移除此词典吗？将删除其数据库及任何残留的源文件；重新加载后不会再次出现。',
    'settings.export': '导出词典',
    'settings.exportFolder': '使用此文件夹',
    'settings.newFolder': '新建文件夹',
    'settings.exportNoSpace': '可用空间不足，无法导出——未复制任何文件。',
    'settings.exportDone': '导出完成',
    'settings.restore': '从此处恢复',
    'settings.restorePrompt': '要从此备份恢复吗？这将替换您当前的词典和已保存的单词。',
    'settings.restoreDone': '已恢复',
    'settings.restoreReopen': '请重新打开插件以完成',
    'settings.restoreNoBackup': '此文件夹中未找到词典备份。',
    'settings.restoreSnapshotFailed': '无法创建安全备份——未做任何更改。',
    'common.keep': '保留',
    'common.delete': '删除',
    'common.cancel': '取消',
  },
  zh_TW: {
    'popup.synonyms': '同義詞',
    'popup.ocr': '辨識',
    'popup.notFoundFor': '未找到定義：',
    'popup.close': '關閉',
    'popup.loading': '載入中…',
    'popup.recognizing': '辨識中…',
    'popup.fontSmaller': '縮小文字',
    'popup.fontLarger': '放大文字',
    'popup.pronunciation': '發音',
    'popup.definition': '釋義',
    'popup.thesaurus': '詞庫',
    'popup.antonyms': '反義詞',
    'popup.noThesaurus': '暫無同義詞或反義詞。',
    'popup.lookUp': '查詢',
    'popup.editOcr': '編輯辨識文字',
    'popup.addDefinition': '新增釋義',
    'popup.headword': '詞條',
    'popup.definitionBody': '釋義',
    'popup.save': '儲存',
    'popup.addEmptyError': '請輸入詞條和釋義。',
    'popup.addFailedError': '儲存失敗，請重試。',
    'popup.copy': '複製',
    'popup.copied': '已複製',
    'popup.copyFailed': '複製失敗',
    'settings.open': '設定',
    'settings.title': '設定',
    'settings.back': '返回',
    'settings.save': '儲存',
    'settings.saved': '設定已儲存',
    'settings.saveFailed': '無法儲存設定',
    'settings.dictionaries': '詞典',
    'settings.moveUp': '上移',
    'settings.moveDown': '下移',
    'settings.enableDict': '啟用',
    'settings.disableDict': '停用',
    'settings.allDisabled': '所有詞典均已關閉——查詢將無結果。',
    'settings.sources': '匯入來源檔案',
    'settings.keepSources': '匯入後保留來源檔案',
    'settings.keepSourcesHint': '關閉時，驗證匯入後將刪除側載檔案。',
    'settings.keepPrompt': '匯入後保留拖入的詞典檔案嗎？選擇「刪除」可在詞典建立完成後移除它們。',
    'settings.removeDict': '移除',
    'settings.deleteDictPrompt':
      '要移除此詞典嗎？將刪除其資料庫及任何殘留的來源檔案；重新載入後不會再次出現。',
    'settings.export': '匯出詞典',
    'settings.exportFolder': '使用此資料夾',
    'settings.newFolder': '新增資料夾',
    'settings.exportNoSpace': '可用空間不足，無法匯出——未複製任何檔案。',
    'settings.exportDone': '匯出完成',
    'settings.restore': '從此處還原',
    'settings.restorePrompt': '要從此備份還原嗎？這將取代您目前的詞典和已儲存的單字。',
    'settings.restoreDone': '已還原',
    'settings.restoreReopen': '請重新開啟外掛以完成',
    'settings.restoreNoBackup': '此資料夾中未找到詞典備份。',
    'settings.restoreSnapshotFailed': '無法建立安全備份——未做任何變更。',
    'common.keep': '保留',
    'common.delete': '刪除',
    'common.cancel': '取消',
  },
  ja: {
    'popup.synonyms': '類義語',
    'popup.ocr': 'OCR',
    'popup.notFoundFor': '定義が見つかりません：',
    'popup.close': '閉じる',
    'popup.loading': '読み込み中…',
    'popup.recognizing': '認識中…',
    'popup.fontSmaller': '文字を小さく',
    'popup.fontLarger': '文字を大きく',
    'popup.pronunciation': '発音',
    'popup.definition': '定義',
    'popup.thesaurus': '類語',
    'popup.antonyms': '対義語',
    'popup.noThesaurus': '同義語・対義語はありません。',
    'popup.lookUp': '検索',
    'popup.editOcr': '認識テキストを編集',
    'popup.addDefinition': '定義を追加',
    'popup.headword': '見出し語',
    'popup.definitionBody': '定義',
    'popup.save': '保存',
    'popup.addEmptyError': '見出し語と定義を入力してください。',
    'popup.addFailedError': '保存できませんでした。もう一度お試しください。',
    'popup.copy': 'コピー',
    'popup.copied': 'コピーしました',
    'popup.copyFailed': 'コピーできませんでした',
    'settings.open': '設定',
    'settings.title': '設定',
    'settings.back': '戻る',
    'settings.save': '保存',
    'settings.saved': '設定を保存しました',
    'settings.saveFailed': '設定を保存できませんでした',
    'settings.dictionaries': '辞書',
    'settings.moveUp': '上へ',
    'settings.moveDown': '下へ',
    'settings.enableDict': '有効',
    'settings.disableDict': '無効',
    'settings.allDisabled': 'すべての辞書がオフです — 検索結果は表示されません。',
    'settings.sources': 'インポート元ファイル',
    'settings.keepSources': 'インポート後に元ファイルを残す',
    'settings.keepSourcesHint':
      'オフの場合、検証済みのインポート後にサイドロードファイルを削除します。',
    'settings.keepPrompt':
      'インポート後に追加した辞書ファイルを残しますか？「削除」を選ぶと辞書の構築後に削除します。',
    'settings.removeDict': '削除',
    'settings.deleteDictPrompt':
      'この辞書を削除しますか？データベースと残っている元ファイルが削除され、再読み込みしても再表示されません。',
    'settings.export': '辞書をエクスポート',
    'settings.exportFolder': 'このフォルダを使う',
    'settings.newFolder': '新しいフォルダ',
    'settings.exportNoSpace': '空き容量が足りません — 何もコピーされませんでした。',
    'settings.exportDone': 'エクスポート完了',
    'settings.restore': 'ここから復元',
    'settings.restorePrompt':
      'このバックアップから復元しますか？現在の辞書と保存した単語が置き換えられます。',
    'settings.restoreDone': '復元しました',
    'settings.restoreReopen': 'プラグインを開き直して完了してください',
    'settings.restoreNoBackup': 'このフォルダに辞書のバックアップが見つかりません。',
    'settings.restoreSnapshotFailed': '安全バックアップを作成できませんでした。変更はありません。',
    'common.keep': '残す',
    'common.delete': '削除',
    'common.cancel': 'キャンセル',
  },
  th: {
    'popup.synonyms': 'คำพ้องความหมาย',
    'popup.ocr': 'OCR',
    'popup.notFoundFor': 'ไม่พบคำจำกัดความสำหรับ',
    'popup.close': 'ปิด',
    'popup.loading': 'กำลังโหลด…',
    'popup.recognizing': 'กำลังรู้จำ…',
    'popup.fontSmaller': 'ลดขนาดตัวอักษร',
    'popup.fontLarger': 'เพิ่มขนาดตัวอักษร',
    'popup.pronunciation': 'การออกเสียง',
    'popup.definition': 'คำจำกัดความ',
    'popup.thesaurus': 'อรรถาภิธาน',
    'popup.antonyms': 'คำตรงข้าม',
    'popup.noThesaurus': 'ไม่มีคำพ้องหรือคำตรงข้าม',
    'popup.lookUp': 'ค้นหา',
    'popup.editOcr': 'แก้ไขข้อความที่รู้จำ',
    'popup.addDefinition': 'เพิ่มคำจำกัดความ',
    'popup.headword': 'คำหลัก',
    'popup.definitionBody': 'คำจำกัดความ',
    'popup.save': 'บันทึก',
    'popup.addEmptyError': 'กรุณาใส่คำหลักและคำจำกัดความ',
    'popup.addFailedError': 'บันทึกไม่สำเร็จ โปรดลองอีกครั้ง',
    'popup.copy': 'คัดลอก',
    'popup.copied': 'คัดลอกแล้ว',
    'popup.copyFailed': 'คัดลอกไม่ได้',
    'settings.open': 'การตั้งค่า',
    'settings.title': 'การตั้งค่า',
    'settings.back': 'ย้อนกลับ',
    'settings.save': 'บันทึก',
    'settings.saved': 'บันทึกการตั้งค่าแล้ว',
    'settings.saveFailed': 'บันทึกการตั้งค่าไม่ได้',
    'settings.dictionaries': 'พจนานุกรม',
    'settings.moveUp': 'เลื่อนขึ้น',
    'settings.moveDown': 'เลื่อนลง',
    'settings.enableDict': 'เปิด',
    'settings.disableDict': 'ปิด',
    'settings.allDisabled': 'ปิดพจนานุกรมทั้งหมดแล้ว — การค้นหาจะไม่มีผลลัพธ์',
    'settings.sources': 'ไฟล์ต้นทางการนำเข้า',
    'settings.keepSources': 'เก็บไฟล์ต้นทางหลังการนำเข้า',
    'settings.keepSourcesHint':
      'เมื่อปิด ระบบจะลบไฟล์ที่ไซด์โหลดหลังการนำเข้าที่ตรวจสอบแล้ว',
    'settings.keepPrompt':
      'เก็บไฟล์พจนานุกรมที่วางไว้หลังการนำเข้าหรือไม่? เลือกลบเพื่อลบออกเมื่อสร้างพจนานุกรมเสร็จ',
    'settings.removeDict': 'ลบออก',
    'settings.deleteDictPrompt':
      'ลบพจนานุกรมนี้หรือไม่? ฐานข้อมูลและไฟล์ต้นทางที่เหลือจะถูกลบ และจะไม่ปรากฏอีกเมื่อโหลดใหม่',
    'settings.export': 'ส่งออกพจนานุกรม',
    'settings.exportFolder': 'ใช้โฟลเดอร์นี้',
    'settings.newFolder': 'โฟลเดอร์ใหม่',
    'settings.exportNoSpace': 'พื้นที่ว่างไม่พอสำหรับการส่งออก — ไม่มีการคัดลอกไฟล์ใด',
    'settings.exportDone': 'ส่งออกเสร็จสิ้น',
    'settings.restore': 'กู้คืนจากที่นี่',
    'settings.restorePrompt':
      'กู้คืนจากข้อมูลสำรองนี้หรือไม่? การดำเนินการนี้จะแทนที่พจนานุกรมและคำที่บันทึกไว้ของคุณ',
    'settings.restoreDone': 'กู้คืนแล้ว',
    'settings.restoreReopen': 'เปิดปลั๊กอินใหม่เพื่อให้เสร็จสมบูรณ์',
    'settings.restoreNoBackup': 'ไม่พบข้อมูลสำรองพจนานุกรมในโฟลเดอร์นี้',
    'settings.restoreSnapshotFailed': 'สร้างข้อมูลสำรองนิรภัยไม่ได้ — ไม่มีการเปลี่ยนแปลง',
    'common.keep': 'เก็บ',
    'common.delete': 'ลบ',
    'common.cancel': 'ยกเลิก',
  },
  nl: {
    'popup.synonyms': 'Synoniemen',
    'popup.ocr': 'OCR',
    'popup.notFoundFor': 'Geen definitie gevonden voor',
    'popup.close': 'Sluiten',
    'popup.loading': 'Bezig met laden…',
    'popup.recognizing': 'Bezig met herkennen…',
    'popup.fontSmaller': 'Tekst verkleinen',
    'popup.fontLarger': 'Tekst vergroten',
    'popup.pronunciation': 'Uitspraak',
    'popup.definition': 'Definitie',
    'popup.thesaurus': 'Thesaurus',
    'popup.antonyms': 'Antoniemen',
    'popup.noThesaurus': 'Geen synoniemen of antoniemen beschikbaar.',
    'popup.lookUp': 'Opzoeken',
    'popup.editOcr': 'Herkende tekst bewerken',
    'popup.addDefinition': 'Definitie toevoegen',
    'popup.headword': 'Trefwoord',
    'popup.definitionBody': 'Definitie',
    'popup.save': 'Opslaan',
    'popup.addEmptyError': 'Voer een trefwoord en een definitie in.',
    'popup.addFailedError': 'Opslaan mislukt — probeer opnieuw.',
    'popup.copy': 'Kopiëren',
    'popup.copied': 'Gekopieerd',
    'popup.copyFailed': 'Kopiëren mislukt',
    'settings.open': 'Instellingen',
    'settings.title': 'Instellingen',
    'settings.back': 'Terug',
    'settings.save': 'Opslaan',
    'settings.saved': 'Instellingen opgeslagen',
    'settings.saveFailed': 'Kan instellingen niet opslaan',
    'settings.dictionaries': 'Woordenboeken',
    'settings.moveUp': 'Omhoog',
    'settings.moveDown': 'Omlaag',
    'settings.enableDict': 'Inschakelen',
    'settings.disableDict': 'Uitschakelen',
    'settings.allDisabled':
      'Alle woordenboeken zijn uit — zoekopdrachten geven niets terug.',
    'settings.sources': 'Importbronnen',
    'settings.keepSources': 'Bronbestanden behouden na import',
    'settings.keepSourcesHint':
      'Indien uit, worden gesideloade bestanden na een geverifieerde import verwijderd.',
    'settings.keepPrompt':
      'De geplaatste woordenboekbestanden na het importeren behouden? Kies Verwijderen om ze te wissen zodra het woordenboek is gebouwd.',
    'settings.removeDict': 'Verwijderen',
    'settings.deleteDictPrompt':
      'Dit woordenboek verwijderen? De database en eventuele resterende bronbestanden worden gewist; het komt na opnieuw laden niet terug.',
    'settings.export': 'Woordenboeken exporteren',
    'settings.exportFolder': 'Deze map gebruiken',
    'settings.newFolder': 'Nieuwe map',
    'settings.exportNoSpace':
      'Onvoldoende vrije ruimte om te exporteren — er is niets gekopieerd.',
    'settings.exportDone': 'Export voltooid',
    'settings.restore': 'Vanaf hier herstellen',
    'settings.restorePrompt':
      'Herstellen vanaf deze back-up? Dit vervangt je huidige woordenboeken en opgeslagen woorden.',
    'settings.restoreDone': 'Hersteld',
    'settings.restoreReopen': 'open de plug-in opnieuw om te voltooien',
    'settings.restoreNoBackup': 'Geen woordenboekback-ups in deze map gevonden.',
    'settings.restoreSnapshotFailed': 'Kon geen veiligheidsback-up maken — er is niets gewijzigd.',
    'common.keep': 'Behouden',
    'common.delete': 'Verwijderen',
    'common.cancel': 'Annuleren',
  },
  de: {
    'popup.synonyms': 'Synonyme',
    'popup.ocr': 'OCR',
    'popup.notFoundFor': 'Keine Definition gefunden für',
    'popup.close': 'Schließen',
    'popup.loading': 'Wird geladen…',
    'popup.recognizing': 'Wird erkannt…',
    'popup.fontSmaller': 'Schrift verkleinern',
    'popup.fontLarger': 'Schrift vergrößern',
    'popup.pronunciation': 'Aussprache',
    'popup.definition': 'Definition',
    'popup.thesaurus': 'Thesaurus',
    'popup.antonyms': 'Antonyme',
    'popup.noThesaurus': 'Keine Synonyme oder Antonyme verfügbar.',
    'popup.lookUp': 'Nachschlagen',
    'popup.editOcr': 'Erkannten Text bearbeiten',
    'popup.addDefinition': 'Definition hinzufügen',
    'popup.headword': 'Stichwort',
    'popup.definitionBody': 'Definition',
    'popup.save': 'Speichern',
    'popup.addEmptyError': 'Bitte Stichwort und Definition eingeben.',
    'popup.addFailedError': 'Speichern fehlgeschlagen — bitte erneut versuchen.',
    'popup.copy': 'Kopieren',
    'popup.copied': 'Kopiert',
    'popup.copyFailed': 'Kopieren fehlgeschlagen',
    'settings.open': 'Einstellungen',
    'settings.title': 'Einstellungen',
    'settings.back': 'Zurück',
    'settings.save': 'Speichern',
    'settings.saved': 'Einstellungen gespeichert',
    'settings.saveFailed': 'Einstellungen konnten nicht gespeichert werden',
    'settings.dictionaries': 'Wörterbücher',
    'settings.moveUp': 'Nach oben',
    'settings.moveDown': 'Nach unten',
    'settings.enableDict': 'Aktivieren',
    'settings.disableDict': 'Deaktivieren',
    'settings.allDisabled':
      'Alle Wörterbücher sind aus — Suchen liefern nichts.',
    'settings.sources': 'Importquellen',
    'settings.keepSources': 'Quelldateien nach Import behalten',
    'settings.keepSourcesHint':
      'Wenn aus, werden sideloadete Dateien nach einem verifizierten Import gelöscht.',
    'settings.keepPrompt':
      'Die abgelegten Wörterbuchdateien nach dem Import behalten? Wählen Sie Löschen, um sie nach dem Aufbau zu entfernen.',
    'settings.removeDict': 'Entfernen',
    'settings.deleteDictPrompt':
      'Dieses Wörterbuch entfernen? Seine Datenbank und etwaige übrige Quelldateien werden gelöscht; es erscheint beim Neuladen nicht wieder.',
    'settings.export': 'Wörterbücher exportieren',
    'settings.exportFolder': 'Diesen Ordner verwenden',
    'settings.newFolder': 'Neuer Ordner',
    'settings.exportNoSpace':
      'Nicht genug freier Speicher zum Exportieren — es wurde nichts kopiert.',
    'settings.exportDone': 'Export abgeschlossen',
    'settings.restore': 'Von hier wiederherstellen',
    'settings.restorePrompt':
      'Aus dieser Sicherung wiederherstellen? Dies ersetzt Ihre aktuellen Wörterbücher und gespeicherten Wörter.',
    'settings.restoreDone': 'Wiederhergestellt',
    'settings.restoreReopen': 'Plugin neu öffnen, um abzuschließen',
    'settings.restoreNoBackup': 'Keine Wörterbuch-Sicherungen in diesem Ordner gefunden.',
    'settings.restoreSnapshotFailed': 'Sicherheitskopie fehlgeschlagen — nichts wurde geändert.',
    'common.keep': 'Behalten',
    'common.delete': 'Löschen',
    'common.cancel': 'Abbrechen',
  },
};

// Toolbar button label — the firmware reads this as a JSON-encoded
// {locale: string} map and picks the right one for the device
// locale (see Sticker plugin's logcat trace for the proven shape).
const BUTTON_NAME: Record<string, string> = {
  en: 'Lookup',
  zh_CN: '查询',
  zh_TW: '查詢',
  ja: '検索',
  th: 'ค้นหา',
  nl: 'Opzoeken',
  de: 'Nachschlagen',
};

// Plugin display name on the plugin manager card.
const PLUGIN_NAME: Record<string, string> = {
  en: 'Dictionary',
  zh_CN: '词典',
  zh_TW: '詞典',
  ja: '辞書',
  th: 'พจนานุกรม',
  nl: 'Woordenboek',
  de: 'Wörterbuch',
};

const FALLBACK_LOCALE = 'en';

const normaliseLocale = (raw: string): string => {
  // Map BCP-47 hyphens to firmware-style underscores so 'zh-CN' from
  // Intl resolves the same row as our 'zh_CN' table key.
  const swap = raw.replace('-', '_');
  if (STRINGS[swap]) {
    return swap;
  }
  // Try language-only (e.g. 'zh_HK' -> 'zh' -> not present, then en).
  const lang = swap.split('_')[0];
  if (STRINGS[lang]) {
    return lang;
  }
  // Cantonese / Hong Kong falls back to traditional rather than en.
  if (swap.startsWith('zh') && STRINGS.zh_TW) {
    return 'zh_TW';
  }
  return FALLBACK_LOCALE;
};

export const detectLocale = (): string => {
  try {
    if (typeof Intl !== 'undefined' && Intl.Collator) {
      const resolved = new Intl.Collator().resolvedOptions().locale;
      if (resolved) {
        return normaliseLocale(resolved);
      }
    }
  } catch {
    // fall through
  }
  return FALLBACK_LOCALE;
};

const LOCALE = detectLocale();

export const t = (id: StringId, locale: string = LOCALE): string => {
  const resolved = normaliseLocale(locale);
  return (
    STRINGS[resolved]?.[id] ?? STRINGS[FALLBACK_LOCALE][id] ?? String(id)
  );
};

// JSON-encoded map of {locale: name} — what the firmware expects in
// PluginButton.name and PluginConfig.json's `name` field. Identical
// shape across both, so one helper covers both consumers.
export const localizedButtonName = (): string => JSON.stringify(BUTTON_NAME);
export const localizedPluginName = (): string => JSON.stringify(PLUGIN_NAME);

export const __testing__ = {
  STRINGS,
  BUTTON_NAME,
  PLUGIN_NAME,
  normaliseLocale,
};

/* AUTO-GENERATED - DO NOT EDIT BY HAND. */
import type { Ptr } from './pdf-runtime-module';

export interface PdfFunctions {
  EPDF_GetMetaKeyCount: (arg0: Ptr, arg1: boolean) => number;
  EPDF_GetMetaKeyName: (arg0: Ptr, arg1: number, arg2: boolean, arg3: Ptr, arg4: number) => number;
  EPDF_GetMetaTrapped: (arg0: Ptr) => Ptr;
  EPDF_GetPageRotationByIndex: (arg0: Ptr, arg1: number) => number;
  EPDF_GetPageSizeByIndexNormalized: (arg0: Ptr, arg1: number, arg2: Ptr) => boolean;
  EPDF_HasMetaText: (arg0: Ptr, arg1: string) => boolean;
  EPDF_IsEncrypted: (arg0: Ptr) => boolean;
  EPDF_IsOwnerUnlocked: (arg0: Ptr) => boolean;
  EPDF_LoadPageNormalized: (arg0: Ptr, arg1: number, arg2: Ptr) => Ptr;
  EPDF_PNG_EncodeRGBA: (
    arg0: Ptr,
    arg1: number,
    arg2: number,
    arg3: number,
    arg4: number,
    arg5: Ptr,
  ) => bigint;
  EPDF_RemoveEncryption: (arg0: Ptr) => boolean;
  EPDF_RenderAnnotBitmap: (
    arg0: Ptr,
    arg1: Ptr,
    arg2: Ptr,
    arg3: Ptr,
    arg4: Ptr,
    arg5: number,
  ) => boolean;
  EPDF_RenderAnnotBitmapUnrotated: (
    arg0: Ptr,
    arg1: Ptr,
    arg2: Ptr,
    arg3: Ptr,
    arg4: Ptr,
    arg5: number,
  ) => boolean;
  EPDF_SetEncryption: (arg0: Ptr, arg1: string, arg2: string, arg3: number) => boolean;
  EPDF_SetMetaText: (arg0: Ptr, arg1: string, arg2: Ptr) => boolean;
  EPDF_SetMetaTrapped: (arg0: Ptr, arg1: Ptr) => boolean;
  EPDF_UnlockOwnerPermissions: (arg0: Ptr, arg1: string) => boolean;
  EPDFAction_CreateGoTo: (arg0: Ptr, arg1: Ptr) => Ptr;
  EPDFAction_CreateGoToNamed: (arg0: Ptr, arg1: string) => Ptr;
  EPDFAction_CreateLaunch: (arg0: Ptr, arg1: Ptr) => Ptr;
  EPDFAction_CreateRemoteGoToByName: (arg0: Ptr, arg1: Ptr, arg2: Ptr) => Ptr;
  EPDFAction_CreateRemoteGoToDest: (arg0: Ptr, arg1: Ptr, arg2: Ptr) => Ptr;
  EPDFAction_CreateURI: (arg0: Ptr, arg1: string) => Ptr;
  EPDFAnnot_ApplyRedaction: (arg0: Ptr, arg1: Ptr) => boolean;
  EPDFAnnot_ClearBorderEffect: (arg0: Ptr) => boolean;
  EPDFAnnot_ClearColor: (arg0: Ptr, arg1: number) => boolean;
  EPDFAnnot_ClearMKColor: (arg0: Ptr, arg1: number) => boolean;
  EPDFAnnot_ClearRectangleDifferences: (arg0: Ptr) => boolean;
  EPDFAnnot_ExportAppearanceAsDocument: (arg0: Ptr) => Ptr;
  EPDFAnnot_ExportMultipleAppearancesAsDocument: (arg0: Ptr, arg1: number) => Ptr;
  EPDFAnnot_Flatten: (arg0: Ptr, arg1: Ptr) => boolean;
  EPDFAnnot_GenerateAppearance: (arg0: Ptr) => boolean;
  EPDFAnnot_GenerateAppearanceWithBlend: (arg0: Ptr, arg1: Ptr) => boolean;
  EPDFAnnot_GenerateFormFieldAP: (arg0: Ptr) => boolean;
  EPDFAnnot_GetAPMatrix: (arg0: Ptr, arg1: Ptr, arg2: Ptr) => boolean;
  EPDFAnnot_GetAvailableAppearanceModes: (arg0: Ptr) => number;
  EPDFAnnot_GetBlendMode: (arg0: Ptr) => Ptr;
  EPDFAnnot_GetBorderDashPattern: (arg0: Ptr, arg1: number, arg2: number) => boolean;
  EPDFAnnot_GetBorderDashPatternCount: (arg0: Ptr) => number;
  EPDFAnnot_GetBorderEffect: (arg0: Ptr, arg1: number) => boolean;
  EPDFAnnot_GetBorderStyle: (arg0: Ptr, arg1: number) => Ptr;
  EPDFAnnot_GetButtonExportValue: (arg0: Ptr, arg1: Ptr, arg2: number) => number;
  EPDFAnnot_GetCalloutLine: (arg0: Ptr, arg1: Ptr, arg2: number) => number;
  EPDFAnnot_GetCalloutLineCount: (arg0: Ptr) => number;
  EPDFAnnot_GetColor: (arg0: Ptr, arg1: number, arg2: Ptr, arg3: Ptr, arg4: Ptr) => boolean;
  EPDFAnnot_GetDefaultAppearance: (
    arg0: Ptr,
    arg1: Ptr,
    arg2: number,
    arg3: Ptr,
    arg4: Ptr,
    arg5: Ptr,
  ) => boolean;
  EPDFAnnot_GetExtendedRotation: (arg0: Ptr, arg1: number) => boolean;
  EPDFAnnot_GetFormFieldObjectNumber: (arg0: Ptr, arg1: Ptr) => number;
  EPDFAnnot_GetFormFieldRawValue: (arg0: Ptr, arg1: Ptr, arg2: Ptr, arg3: number) => number;
  EPDFAnnot_GetIntent: (arg0: Ptr, arg1: Ptr, arg2: number) => number;
  EPDFAnnot_GetLineEndings: (arg0: Ptr, arg1: Ptr, arg2: Ptr) => boolean;
  EPDFAnnot_GetMKColor: (arg0: Ptr, arg1: number, arg2: Ptr, arg3: Ptr, arg4: Ptr) => boolean;
  EPDFAnnot_GetName: (arg0: Ptr) => Ptr;
  EPDFAnnot_GetOpacity: (arg0: Ptr, arg1: Ptr) => boolean;
  EPDFAnnot_GetOverlayText: (arg0: Ptr, arg1: Ptr, arg2: number) => number;
  EPDFAnnot_GetOverlayTextRepeat: (arg0: Ptr) => boolean;
  EPDFAnnot_GetRect: (arg0: Ptr, arg1: Ptr) => boolean;
  EPDFAnnot_GetRectangleDifferences: (
    arg0: Ptr,
    arg1: number,
    arg2: number,
    arg3: number,
    arg4: number,
  ) => boolean;
  EPDFAnnot_GetReplyType: (arg0: Ptr) => Ptr;
  EPDFAnnot_GetRichContent: (arg0: Ptr, arg1: Ptr, arg2: number) => number;
  EPDFAnnot_GetRotate: (arg0: Ptr, arg1: number) => boolean;
  EPDFAnnot_GetTextAlignment: (arg0: Ptr) => Ptr;
  EPDFAnnot_GetUnrotatedRect: (arg0: Ptr, arg1: Ptr) => boolean;
  EPDFAnnot_GetVerticalAlignment: (arg0: Ptr) => Ptr;
  EPDFAnnot_HasAppearanceStream: (arg0: Ptr, arg1: Ptr) => boolean;
  EPDFAnnot_SetAction: (arg0: Ptr, arg1: Ptr) => boolean;
  EPDFAnnot_SetAPMatrix: (arg0: Ptr, arg1: Ptr, arg2: Ptr) => boolean;
  EPDFAnnot_SetAppearanceFromPage: (arg0: Ptr, arg1: Ptr, arg2: number) => boolean;
  EPDFAnnot_SetBorderDashPattern: (arg0: Ptr, arg1: number, arg2: number) => boolean;
  EPDFAnnot_SetBorderEffect: (arg0: Ptr, arg1: number) => boolean;
  EPDFAnnot_SetBorderStyle: (arg0: Ptr, arg1: Ptr, arg2: number) => boolean;
  EPDFAnnot_SetCalloutLine: (arg0: Ptr, arg1: Ptr, arg2: number) => boolean;
  EPDFAnnot_SetColor: (
    arg0: Ptr,
    arg1: number,
    arg2: number,
    arg3: number,
    arg4: number,
  ) => boolean;
  EPDFAnnot_SetDefaultAppearance: (
    arg0: Ptr,
    arg1: Ptr,
    arg2: number,
    arg3: number,
    arg4: number,
    arg5: number,
  ) => boolean;
  EPDFAnnot_SetExtendedRotation: (arg0: Ptr, arg1: number) => boolean;
  EPDFAnnot_SetFormFieldName: (arg0: Ptr, arg1: Ptr, arg2: Ptr) => boolean;
  EPDFAnnot_SetFormFieldOptions: (arg0: Ptr, arg1: Ptr, arg2: Ptr, arg3: number) => boolean;
  EPDFAnnot_SetFormFieldValue: (arg0: Ptr, arg1: Ptr, arg2: Ptr) => boolean;
  EPDFAnnot_SetIntent: (arg0: Ptr, arg1: string) => boolean;
  EPDFAnnot_SetLine: (arg0: Ptr, arg1: Ptr, arg2: Ptr) => boolean;
  EPDFAnnot_SetLineEndings: (arg0: Ptr, arg1: Ptr, arg2: Ptr) => boolean;
  EPDFAnnot_SetLinkedAnnot: (arg0: Ptr, arg1: string, arg2: Ptr) => boolean;
  EPDFAnnot_SetMKColor: (
    arg0: Ptr,
    arg1: number,
    arg2: number,
    arg3: number,
    arg4: number,
  ) => boolean;
  EPDFAnnot_SetName: (arg0: Ptr, arg1: Ptr) => boolean;
  EPDFAnnot_SetNumberValue: (arg0: Ptr, arg1: string, arg2: number) => boolean;
  EPDFAnnot_SetOpacity: (arg0: Ptr, arg1: number) => boolean;
  EPDFAnnot_SetOverlayText: (arg0: Ptr, arg1: Ptr) => boolean;
  EPDFAnnot_SetOverlayTextRepeat: (arg0: Ptr, arg1: boolean) => boolean;
  EPDFAnnot_SetRectangleDifferences: (
    arg0: Ptr,
    arg1: number,
    arg2: number,
    arg3: number,
    arg4: number,
  ) => boolean;
  EPDFAnnot_SetReplyType: (arg0: Ptr, arg1: Ptr) => boolean;
  EPDFAnnot_SetRotate: (arg0: Ptr, arg1: number) => boolean;
  EPDFAnnot_SetTextAlignment: (arg0: Ptr, arg1: Ptr) => boolean;
  EPDFAnnot_SetUnrotatedRect: (arg0: Ptr, arg1: Ptr) => boolean;
  EPDFAnnot_SetVerticalAlignment: (arg0: Ptr, arg1: Ptr) => boolean;
  EPDFAnnot_SetVertices: (arg0: Ptr, arg1: Ptr, arg2: number) => boolean;
  EPDFAnnot_ShareFormField: (arg0: Ptr, arg1: Ptr, arg2: Ptr) => boolean;
  EPDFAnnot_UpdateAppearanceToRect: (arg0: Ptr, arg1: number) => boolean;
  EPDFAttachment_GetDescription: (arg0: Ptr, arg1: Ptr, arg2: number) => number;
  EPDFAttachment_GetIntegerValue: (arg0: Ptr, arg1: string, arg2: Ptr) => boolean;
  EPDFAttachment_SetDescription: (arg0: Ptr, arg1: Ptr) => boolean;
  EPDFAttachment_SetSubtype: (arg0: Ptr, arg1: string) => boolean;
  EPDFBookmark_AppendChild: (arg0: Ptr, arg1: Ptr, arg2: Ptr) => Ptr;
  EPDFBookmark_Clear: (arg0: Ptr) => boolean;
  EPDFBookmark_ClearTarget: (arg0: Ptr) => boolean;
  EPDFBookmark_Create: (arg0: Ptr, arg1: Ptr) => Ptr;
  EPDFBookmark_Delete: (arg0: Ptr, arg1: Ptr) => boolean;
  EPDFBookmark_InsertAfter: (arg0: Ptr, arg1: Ptr, arg2: Ptr, arg3: Ptr) => Ptr;
  EPDFBookmark_SetAction: (arg0: Ptr, arg1: Ptr, arg2: Ptr) => boolean;
  EPDFBookmark_SetDest: (arg0: Ptr, arg1: Ptr, arg2: Ptr) => boolean;
  EPDFBookmark_SetTitle: (arg0: Ptr, arg1: Ptr) => boolean;
  EPDFCatalog_GetLanguage: (arg0: Ptr, arg1: Ptr, arg2: number) => number;
  EPDFDest_CreateRemoteView: (
    arg0: Ptr,
    arg1: number,
    arg2: number,
    arg3: Ptr,
    arg4: number,
  ) => Ptr;
  EPDFDest_CreateRemoteXYZ: (
    arg0: Ptr,
    arg1: number,
    arg2: boolean,
    arg3: Ptr,
    arg4: boolean,
    arg5: Ptr,
    arg6: boolean,
    arg7: Ptr,
  ) => Ptr;
  EPDFDest_CreateView: (arg0: Ptr, arg1: number, arg2: Ptr, arg3: number) => Ptr;
  EPDFDest_CreateXYZ: (
    arg0: Ptr,
    arg1: boolean,
    arg2: Ptr,
    arg3: boolean,
    arg4: Ptr,
    arg5: boolean,
    arg6: Ptr,
  ) => Ptr;
  EPDFImageObj_SetJpeg: (arg0: Ptr, arg1: number, arg2: Ptr, arg3: Ptr, arg4: bigint) => boolean;
  EPDFImageObj_SetPng: (arg0: Ptr, arg1: number, arg2: Ptr, arg3: Ptr, arg4: bigint) => boolean;
  EPDFNamedDest_Remove: (arg0: Ptr, arg1: string) => boolean;
  EPDFNamedDest_SetDest: (arg0: Ptr, arg1: string, arg2: Ptr) => boolean;
  EPDFPage_ApplyRedactions: (arg0: Ptr) => boolean;
  EPDFPage_CreateAnnot: (arg0: Ptr, arg1: Ptr) => Ptr;
  EPDFPage_CreateFormField: (arg0: Ptr, arg1: Ptr, arg2: number, arg3: Ptr) => Ptr;
  EPDFPage_GetAnnotByName: (arg0: Ptr, arg1: Ptr) => Ptr;
  EPDFPage_GetAnnotCountRaw: (arg0: Ptr, arg1: number) => number;
  EPDFPage_GetAnnotRaw: (arg0: Ptr, arg1: number, arg2: number) => Ptr;
  EPDFPage_RemoveAnnotByName: (arg0: Ptr, arg1: Ptr) => boolean;
  EPDFPage_RemoveAnnotRaw: (arg0: Ptr, arg1: number, arg2: number) => boolean;
  EPDFText_RedactInQuads: (
    arg0: Ptr,
    arg1: Ptr,
    arg2: bigint,
    arg3: boolean,
    arg4: boolean,
  ) => boolean;
  EPDFText_RedactInRect: (arg0: Ptr, arg1: Ptr, arg2: boolean, arg3: boolean) => boolean;
  FORM_CanRedo: (arg0: Ptr, arg1: Ptr) => boolean;
  FORM_CanUndo: (arg0: Ptr, arg1: Ptr) => boolean;
  FORM_DoDocumentAAction: (arg0: Ptr, arg1: number) => void;
  FORM_DoDocumentJSAction: (arg0: Ptr) => void;
  FORM_DoDocumentOpenAction: (arg0: Ptr) => void;
  FORM_DoPageAAction: (arg0: Ptr, arg1: Ptr, arg2: number) => void;
  FORM_ForceToKillFocus: (arg0: Ptr) => boolean;
  FORM_GetFocusedAnnot: (arg0: Ptr, arg1: Ptr, arg2: Ptr) => boolean;
  FORM_GetFocusedText: (arg0: Ptr, arg1: Ptr, arg2: Ptr, arg3: number) => number;
  FORM_GetSelectedText: (arg0: Ptr, arg1: Ptr, arg2: Ptr, arg3: number) => number;
  FORM_IsIndexSelected: (arg0: Ptr, arg1: Ptr, arg2: number) => boolean;
  FORM_OnAfterLoadPage: (arg0: Ptr, arg1: Ptr) => void;
  FORM_OnBeforeClosePage: (arg0: Ptr, arg1: Ptr) => void;
  FORM_OnChar: (arg0: Ptr, arg1: Ptr, arg2: number, arg3: number) => boolean;
  FORM_OnFocus: (arg0: Ptr, arg1: Ptr, arg2: number, arg3: number, arg4: number) => boolean;
  FORM_OnKeyDown: (arg0: Ptr, arg1: Ptr, arg2: number, arg3: number) => boolean;
  FORM_OnKeyUp: (arg0: Ptr, arg1: Ptr, arg2: number, arg3: number) => boolean;
  FORM_OnLButtonDoubleClick: (
    arg0: Ptr,
    arg1: Ptr,
    arg2: number,
    arg3: number,
    arg4: number,
  ) => boolean;
  FORM_OnLButtonDown: (arg0: Ptr, arg1: Ptr, arg2: number, arg3: number, arg4: number) => boolean;
  FORM_OnLButtonUp: (arg0: Ptr, arg1: Ptr, arg2: number, arg3: number, arg4: number) => boolean;
  FORM_OnMouseMove: (arg0: Ptr, arg1: Ptr, arg2: number, arg3: number, arg4: number) => boolean;
  FORM_OnMouseWheel: (
    arg0: Ptr,
    arg1: Ptr,
    arg2: number,
    arg3: Ptr,
    arg4: number,
    arg5: number,
  ) => boolean;
  FORM_OnRButtonDown: (arg0: Ptr, arg1: Ptr, arg2: number, arg3: number, arg4: number) => boolean;
  FORM_OnRButtonUp: (arg0: Ptr, arg1: Ptr, arg2: number, arg3: number, arg4: number) => boolean;
  FORM_Redo: (arg0: Ptr, arg1: Ptr) => boolean;
  FORM_ReplaceAndKeepSelection: (arg0: Ptr, arg1: Ptr, arg2: Ptr) => void;
  FORM_ReplaceSelection: (arg0: Ptr, arg1: Ptr, arg2: Ptr) => void;
  FORM_SelectAllText: (arg0: Ptr, arg1: Ptr) => boolean;
  FORM_SetFocusedAnnot: (arg0: Ptr, arg1: Ptr) => boolean;
  FORM_SetIndexSelected: (arg0: Ptr, arg1: Ptr, arg2: number, arg3: boolean) => boolean;
  FORM_Undo: (arg0: Ptr, arg1: Ptr) => boolean;
  FPDF_AddInstalledFont: (arg0: Ptr, arg1: Ptr, arg2: number) => void;
  FPDF_CloseDocument: (arg0: Ptr) => void;
  FPDF_ClosePage: (arg0: Ptr) => void;
  FPDF_CloseXObject: (arg0: Ptr) => void;
  FPDF_CopyViewerPreferences: (arg0: Ptr, arg1: Ptr) => boolean;
  FPDF_CountNamedDests: (arg0: Ptr) => Ptr;
  FPDF_CreateClipPath: (arg0: number, arg1: number, arg2: number, arg3: number) => Ptr;
  FPDF_CreateNewDocument: () => Ptr;
  FPDF_DestroyClipPath: (arg0: Ptr) => void;
  FPDF_DestroyLibrary: () => void;
  FPDF_DeviceToPage: (
    arg0: Ptr,
    arg1: number,
    arg2: number,
    arg3: number,
    arg4: number,
    arg5: number,
    arg6: number,
    arg7: number,
    arg8: number,
    arg9: number,
  ) => boolean;
  FPDF_DocumentHasValidCrossReferenceTable: (arg0: Ptr) => boolean;
  FPDF_FFLDraw: (
    arg0: Ptr,
    arg1: Ptr,
    arg2: Ptr,
    arg3: number,
    arg4: number,
    arg5: number,
    arg6: number,
    arg7: number,
    arg8: number,
  ) => void;
  FPDF_FreeDefaultSystemFontInfo: (arg0: Ptr) => void;
  FPDF_GetDefaultSystemFontInfo: () => Ptr;
  FPDF_GetDefaultTTFMap: () => Ptr;
  FPDF_GetDefaultTTFMapCount: () => bigint;
  FPDF_GetDefaultTTFMapEntry: (arg0: bigint) => Ptr;
  FPDF_GetDocPermissions: (arg0: Ptr) => number;
  FPDF_GetDocUserPermissions: (arg0: Ptr) => number;
  FPDF_GetFileIdentifier: (arg0: Ptr, arg1: Ptr, arg2: Ptr, arg3: number) => number;
  FPDF_GetFileVersion: (arg0: Ptr, arg1: Ptr) => boolean;
  FPDF_GetFormType: (arg0: Ptr) => number;
  FPDF_GetLastError: () => number;
  FPDF_GetMetaText: (arg0: Ptr, arg1: string, arg2: Ptr, arg3: number) => number;
  FPDF_GetNamedDest: (arg0: Ptr, arg1: number, arg2: Ptr, arg3: Ptr) => Ptr;
  FPDF_GetNamedDestByName: (arg0: Ptr, arg1: string) => Ptr;
  FPDF_GetPageAAction: (arg0: Ptr, arg1: number) => Ptr;
  FPDF_GetPageBoundingBox: (arg0: Ptr, arg1: Ptr) => boolean;
  FPDF_GetPageCount: (arg0: Ptr) => number;
  FPDF_GetPageHeight: (arg0: Ptr) => number;
  FPDF_GetPageHeightF: (arg0: Ptr) => number;
  FPDF_GetPageLabel: (arg0: Ptr, arg1: number, arg2: Ptr, arg3: number) => number;
  FPDF_GetPageSizeByIndex: (arg0: Ptr, arg1: number, arg2: number, arg3: number) => number;
  FPDF_GetPageSizeByIndexF: (arg0: Ptr, arg1: number, arg2: Ptr) => boolean;
  FPDF_GetPageWidth: (arg0: Ptr) => number;
  FPDF_GetPageWidthF: (arg0: Ptr) => number;
  FPDF_GetSecurityHandlerRevision: (arg0: Ptr) => number;
  FPDF_GetSignatureCount: (arg0: Ptr) => number;
  FPDF_GetSignatureObject: (arg0: Ptr, arg1: number) => Ptr;
  FPDF_GetTrailerEnds: (arg0: Ptr, arg1: Ptr, arg2: number) => number;
  FPDF_GetXFAPacketContent: (
    arg0: Ptr,
    arg1: number,
    arg2: Ptr,
    arg3: number,
    arg4: Ptr,
  ) => boolean;
  FPDF_GetXFAPacketCount: (arg0: Ptr) => number;
  FPDF_GetXFAPacketName: (arg0: Ptr, arg1: number, arg2: Ptr, arg3: number) => number;
  FPDF_ImportNPagesToOne: (
    arg0: Ptr,
    arg1: number,
    arg2: number,
    arg3: bigint,
    arg4: bigint,
  ) => Ptr;
  FPDF_ImportPages: (arg0: Ptr, arg1: Ptr, arg2: string, arg3: number) => boolean;
  FPDF_ImportPagesByIndex: (arg0: Ptr, arg1: Ptr, arg2: Ptr, arg3: number, arg4: number) => boolean;
  FPDF_InitLibrary: () => void;
  FPDF_InitLibraryWithConfig: (arg0: Ptr) => void;
  FPDF_LoadCustomDocument: (arg0: Ptr, arg1: string) => Ptr;
  FPDF_LoadDocument: (arg0: Ptr, arg1: string) => Ptr;
  FPDF_LoadMemDocument: (arg0: Ptr, arg1: number, arg2: string) => Ptr;
  FPDF_LoadMemDocument64: (arg0: Ptr, arg1: bigint, arg2: string) => Ptr;
  FPDF_LoadPage: (arg0: Ptr, arg1: number) => Ptr;
  FPDF_LoadXFA: (arg0: Ptr) => boolean;
  FPDF_MovePages: (arg0: Ptr, arg1: Ptr, arg2: number, arg3: number) => boolean;
  FPDF_NewFormObjectFromXObject: (arg0: Ptr) => Ptr;
  FPDF_NewXObjectFromPage: (arg0: Ptr, arg1: Ptr, arg2: number) => Ptr;
  FPDF_PageToDevice: (
    arg0: Ptr,
    arg1: number,
    arg2: number,
    arg3: number,
    arg4: number,
    arg5: number,
    arg6: number,
    arg7: number,
    arg8: Ptr,
    arg9: Ptr,
  ) => boolean;
  FPDF_RemoveFormFieldHighlight: (arg0: Ptr) => void;
  FPDF_RenderPage_Close: (arg0: Ptr) => void;
  FPDF_RenderPage_Continue: (arg0: Ptr, arg1: Ptr) => number;
  FPDF_RenderPageBitmap: (
    arg0: Ptr,
    arg1: Ptr,
    arg2: number,
    arg3: number,
    arg4: number,
    arg5: number,
    arg6: number,
    arg7: number,
  ) => void;
  FPDF_RenderPageBitmap_Start: (
    arg0: Ptr,
    arg1: Ptr,
    arg2: number,
    arg3: number,
    arg4: number,
    arg5: number,
    arg6: number,
    arg7: number,
    arg8: Ptr,
  ) => number;
  FPDF_RenderPageBitmapWithColorScheme_Start: (
    arg0: Ptr,
    arg1: Ptr,
    arg2: number,
    arg3: number,
    arg4: number,
    arg5: number,
    arg6: number,
    arg7: number,
    arg8: Ptr,
    arg9: Ptr,
  ) => number;
  FPDF_RenderPageBitmapWithMatrix: (
    arg0: Ptr,
    arg1: Ptr,
    arg2: Ptr,
    arg3: Ptr,
    arg4: number,
  ) => void;
  FPDF_SaveAsCopy: (arg0: Ptr, arg1: Ptr, arg2: Ptr) => boolean;
  FPDF_SaveWithVersion: (arg0: Ptr, arg1: Ptr, arg2: Ptr, arg3: number) => boolean;
  FPDF_SetFormFieldHighlightAlpha: (arg0: Ptr, arg1: number) => void;
  FPDF_SetFormFieldHighlightColor: (arg0: Ptr, arg1: number, arg2: number) => void;
  FPDF_SetSandBoxPolicy: (arg0: Ptr, arg1: boolean) => void;
  FPDF_SetSystemFontInfo: (arg0: Ptr) => void;
  FPDF_StructElement_Attr_CountChildren: (arg0: Ptr) => number;
  FPDF_StructElement_Attr_GetBlobValue: (arg0: Ptr, arg1: Ptr, arg2: number, arg3: Ptr) => boolean;
  FPDF_StructElement_Attr_GetBooleanValue: (arg0: Ptr, arg1: boolean) => boolean;
  FPDF_StructElement_Attr_GetChildAtIndex: (arg0: Ptr, arg1: number) => Ptr;
  FPDF_StructElement_Attr_GetCount: (arg0: Ptr) => number;
  FPDF_StructElement_Attr_GetName: (
    arg0: Ptr,
    arg1: number,
    arg2: Ptr,
    arg3: number,
    arg4: Ptr,
  ) => boolean;
  FPDF_StructElement_Attr_GetNumberValue: (arg0: Ptr, arg1: number) => boolean;
  FPDF_StructElement_Attr_GetStringValue: (
    arg0: Ptr,
    arg1: Ptr,
    arg2: number,
    arg3: Ptr,
  ) => boolean;
  FPDF_StructElement_Attr_GetType: (arg0: Ptr) => Ptr;
  FPDF_StructElement_Attr_GetValue: (arg0: Ptr, arg1: string) => Ptr;
  FPDF_StructElement_CountChildren: (arg0: Ptr) => number;
  FPDF_StructElement_GetActualText: (arg0: Ptr, arg1: Ptr, arg2: number) => number;
  FPDF_StructElement_GetAltText: (arg0: Ptr, arg1: Ptr, arg2: number) => number;
  FPDF_StructElement_GetAttributeAtIndex: (arg0: Ptr, arg1: number) => Ptr;
  FPDF_StructElement_GetAttributeCount: (arg0: Ptr) => number;
  FPDF_StructElement_GetChildAtIndex: (arg0: Ptr, arg1: number) => Ptr;
  FPDF_StructElement_GetChildMarkedContentID: (arg0: Ptr, arg1: number) => number;
  FPDF_StructElement_GetID: (arg0: Ptr, arg1: Ptr, arg2: number) => number;
  FPDF_StructElement_GetLang: (arg0: Ptr, arg1: Ptr, arg2: number) => number;
  FPDF_StructElement_GetMarkedContentID: (arg0: Ptr) => number;
  FPDF_StructElement_GetMarkedContentIdAtIndex: (arg0: Ptr, arg1: number) => number;
  FPDF_StructElement_GetMarkedContentIdCount: (arg0: Ptr) => number;
  FPDF_StructElement_GetObjType: (arg0: Ptr, arg1: Ptr, arg2: number) => number;
  FPDF_StructElement_GetParent: (arg0: Ptr) => Ptr;
  FPDF_StructElement_GetStringAttribute: (
    arg0: Ptr,
    arg1: string,
    arg2: Ptr,
    arg3: number,
  ) => number;
  FPDF_StructElement_GetTitle: (arg0: Ptr, arg1: Ptr, arg2: number) => number;
  FPDF_StructElement_GetType: (arg0: Ptr, arg1: Ptr, arg2: number) => number;
  FPDF_StructTree_Close: (arg0: Ptr) => void;
  FPDF_StructTree_CountChildren: (arg0: Ptr) => number;
  FPDF_StructTree_GetChildAtIndex: (arg0: Ptr, arg1: number) => Ptr;
  FPDF_StructTree_GetForPage: (arg0: Ptr) => Ptr;
  FPDF_VIEWERREF_GetDuplex: (arg0: Ptr) => Ptr;
  FPDF_VIEWERREF_GetName: (arg0: Ptr, arg1: string, arg2: Ptr, arg3: number) => number;
  FPDF_VIEWERREF_GetNumCopies: (arg0: Ptr) => number;
  FPDF_VIEWERREF_GetPrintPageRange: (arg0: Ptr) => Ptr;
  FPDF_VIEWERREF_GetPrintPageRangeCount: (arg0: Ptr) => bigint;
  FPDF_VIEWERREF_GetPrintPageRangeElement: (arg0: Ptr, arg1: bigint) => number;
  FPDF_VIEWERREF_GetPrintScaling: (arg0: Ptr) => boolean;
  FPDFAction_GetDest: (arg0: Ptr, arg1: Ptr) => Ptr;
  FPDFAction_GetFilePath: (arg0: Ptr, arg1: Ptr, arg2: number) => number;
  FPDFAction_GetType: (arg0: Ptr) => number;
  FPDFAction_GetURIPath: (arg0: Ptr, arg1: Ptr, arg2: Ptr, arg3: number) => number;
  FPDFAnnot_AddFileAttachment: (arg0: Ptr, arg1: Ptr) => Ptr;
  FPDFAnnot_AddInkStroke: (arg0: Ptr, arg1: Ptr, arg2: bigint) => number;
  FPDFAnnot_AppendAttachmentPoints: (arg0: Ptr, arg1: Ptr) => boolean;
  FPDFAnnot_AppendObject: (arg0: Ptr, arg1: Ptr) => boolean;
  FPDFAnnot_CountAttachmentPoints: (arg0: Ptr) => bigint;
  FPDFAnnot_GetAP: (arg0: Ptr, arg1: Ptr, arg2: Ptr, arg3: number) => number;
  FPDFAnnot_GetAttachmentPoints: (arg0: Ptr, arg1: bigint, arg2: Ptr) => boolean;
  FPDFAnnot_GetBorder: (arg0: Ptr, arg1: number, arg2: number, arg3: number) => boolean;
  FPDFAnnot_GetColor: (
    arg0: Ptr,
    arg1: number,
    arg2: Ptr,
    arg3: Ptr,
    arg4: Ptr,
    arg5: Ptr,
  ) => boolean;
  FPDFAnnot_GetFileAttachment: (arg0: Ptr) => Ptr;
  FPDFAnnot_GetFlags: (arg0: Ptr) => number;
  FPDFAnnot_GetFocusableSubtypes: (arg0: Ptr, arg1: Ptr, arg2: bigint) => boolean;
  FPDFAnnot_GetFocusableSubtypesCount: (arg0: Ptr) => number;
  FPDFAnnot_GetFontColor: (arg0: Ptr, arg1: Ptr, arg2: Ptr, arg3: Ptr, arg4: Ptr) => boolean;
  FPDFAnnot_GetFontSize: (arg0: Ptr, arg1: Ptr, arg2: number) => boolean;
  FPDFAnnot_GetFormAdditionalActionJavaScript: (
    arg0: Ptr,
    arg1: Ptr,
    arg2: number,
    arg3: Ptr,
    arg4: number,
  ) => number;
  FPDFAnnot_GetFormControlCount: (arg0: Ptr, arg1: Ptr) => number;
  FPDFAnnot_GetFormControlIndex: (arg0: Ptr, arg1: Ptr) => number;
  FPDFAnnot_GetFormFieldAlternateName: (arg0: Ptr, arg1: Ptr, arg2: Ptr, arg3: number) => number;
  FPDFAnnot_GetFormFieldAtPoint: (arg0: Ptr, arg1: Ptr, arg2: Ptr) => Ptr;
  FPDFAnnot_GetFormFieldExportValue: (arg0: Ptr, arg1: Ptr, arg2: Ptr, arg3: number) => number;
  FPDFAnnot_GetFormFieldFlags: (arg0: Ptr, arg1: Ptr) => number;
  FPDFAnnot_GetFormFieldName: (arg0: Ptr, arg1: Ptr, arg2: Ptr, arg3: number) => number;
  FPDFAnnot_GetFormFieldType: (arg0: Ptr, arg1: Ptr) => number;
  FPDFAnnot_GetFormFieldValue: (arg0: Ptr, arg1: Ptr, arg2: Ptr, arg3: number) => number;
  FPDFAnnot_GetInkListCount: (arg0: Ptr) => number;
  FPDFAnnot_GetInkListPath: (arg0: Ptr, arg1: number, arg2: Ptr, arg3: number) => number;
  FPDFAnnot_GetLine: (arg0: Ptr, arg1: Ptr, arg2: Ptr) => boolean;
  FPDFAnnot_GetLink: (arg0: Ptr) => Ptr;
  FPDFAnnot_GetLinkedAnnot: (arg0: Ptr, arg1: string) => Ptr;
  FPDFAnnot_GetNumberValue: (arg0: Ptr, arg1: string, arg2: number) => boolean;
  FPDFAnnot_GetObject: (arg0: Ptr, arg1: number) => Ptr;
  FPDFAnnot_GetObjectCount: (arg0: Ptr) => number;
  FPDFAnnot_GetOptionCount: (arg0: Ptr, arg1: Ptr) => number;
  FPDFAnnot_GetOptionLabel: (arg0: Ptr, arg1: Ptr, arg2: number, arg3: Ptr, arg4: number) => number;
  FPDFAnnot_GetRect: (arg0: Ptr, arg1: Ptr) => boolean;
  FPDFAnnot_GetStringValue: (arg0: Ptr, arg1: string, arg2: Ptr, arg3: number) => number;
  FPDFAnnot_GetSubtype: (arg0: Ptr) => Ptr;
  FPDFAnnot_GetValueType: (arg0: Ptr, arg1: string) => Ptr;
  FPDFAnnot_GetVertices: (arg0: Ptr, arg1: Ptr, arg2: number) => number;
  FPDFAnnot_HasAttachmentPoints: (arg0: Ptr) => boolean;
  FPDFAnnot_HasKey: (arg0: Ptr, arg1: string) => boolean;
  FPDFAnnot_IsChecked: (arg0: Ptr, arg1: Ptr) => boolean;
  FPDFAnnot_IsObjectSupportedSubtype: (arg0: Ptr) => boolean;
  FPDFAnnot_IsOptionSelected: (arg0: Ptr, arg1: Ptr, arg2: number) => boolean;
  FPDFAnnot_IsSupportedSubtype: (arg0: Ptr) => boolean;
  FPDFAnnot_RemoveInkList: (arg0: Ptr) => boolean;
  FPDFAnnot_RemoveObject: (arg0: Ptr, arg1: number) => boolean;
  FPDFAnnot_SetAP: (arg0: Ptr, arg1: Ptr, arg2: Ptr) => boolean;
  FPDFAnnot_SetAttachmentPoints: (arg0: Ptr, arg1: bigint, arg2: Ptr) => boolean;
  FPDFAnnot_SetBorder: (arg0: Ptr, arg1: number, arg2: number, arg3: number) => boolean;
  FPDFAnnot_SetColor: (
    arg0: Ptr,
    arg1: number,
    arg2: number,
    arg3: number,
    arg4: number,
    arg5: number,
  ) => boolean;
  FPDFAnnot_SetFlags: (arg0: Ptr, arg1: number) => boolean;
  FPDFAnnot_SetFocusableSubtypes: (arg0: Ptr, arg1: Ptr, arg2: bigint) => boolean;
  FPDFAnnot_SetFontColor: (
    arg0: Ptr,
    arg1: Ptr,
    arg2: number,
    arg3: number,
    arg4: number,
  ) => boolean;
  FPDFAnnot_SetFormFieldFlags: (arg0: Ptr, arg1: Ptr, arg2: number) => boolean;
  FPDFAnnot_SetRect: (arg0: Ptr, arg1: Ptr) => boolean;
  FPDFAnnot_SetStringValue: (arg0: Ptr, arg1: string, arg2: Ptr) => boolean;
  FPDFAnnot_SetURI: (arg0: Ptr, arg1: Ptr) => boolean;
  FPDFAnnot_UpdateObject: (arg0: Ptr, arg1: Ptr) => boolean;
  FPDFAttachment_GetFile: (arg0: Ptr, arg1: Ptr, arg2: number, arg3: Ptr) => boolean;
  FPDFAttachment_GetName: (arg0: Ptr, arg1: Ptr, arg2: number) => number;
  FPDFAttachment_GetStringValue: (arg0: Ptr, arg1: string, arg2: Ptr, arg3: number) => number;
  FPDFAttachment_GetSubtype: (arg0: Ptr, arg1: Ptr, arg2: number) => number;
  FPDFAttachment_GetValueType: (arg0: Ptr, arg1: string) => Ptr;
  FPDFAttachment_HasKey: (arg0: Ptr, arg1: string) => boolean;
  FPDFAttachment_SetFile: (arg0: Ptr, arg1: Ptr, arg2: Ptr, arg3: number) => boolean;
  FPDFAttachment_SetStringValue: (arg0: Ptr, arg1: string, arg2: Ptr) => boolean;
  FPDFAvail_Create: (arg0: Ptr, arg1: Ptr) => Ptr;
  FPDFAvail_Destroy: (arg0: Ptr) => void;
  FPDFAvail_GetDocument: (arg0: Ptr, arg1: string) => Ptr;
  FPDFAvail_GetFirstPageNum: (arg0: Ptr) => number;
  FPDFAvail_IsDocAvail: (arg0: Ptr, arg1: Ptr) => number;
  FPDFAvail_IsFormAvail: (arg0: Ptr, arg1: Ptr) => number;
  FPDFAvail_IsLinearized: (arg0: Ptr) => number;
  FPDFAvail_IsPageAvail: (arg0: Ptr, arg1: number, arg2: Ptr) => number;
  FPDFBitmap_Create: (arg0: number, arg1: number, arg2: number) => Ptr;
  FPDFBitmap_CreateEx: (arg0: number, arg1: number, arg2: number, arg3: Ptr, arg4: number) => Ptr;
  FPDFBitmap_Destroy: (arg0: Ptr) => void;
  FPDFBitmap_FillRect: (
    arg0: Ptr,
    arg1: number,
    arg2: number,
    arg3: number,
    arg4: number,
    arg5: Ptr,
  ) => boolean;
  FPDFBitmap_GetBuffer: (arg0: Ptr) => Ptr;
  FPDFBitmap_GetFormat: (arg0: Ptr) => number;
  FPDFBitmap_GetHeight: (arg0: Ptr) => number;
  FPDFBitmap_GetStride: (arg0: Ptr) => number;
  FPDFBitmap_GetWidth: (arg0: Ptr) => number;
  FPDFBookmark_Find: (arg0: Ptr, arg1: Ptr) => Ptr;
  FPDFBookmark_GetAction: (arg0: Ptr) => Ptr;
  FPDFBookmark_GetCount: (arg0: Ptr) => number;
  FPDFBookmark_GetDest: (arg0: Ptr, arg1: Ptr) => Ptr;
  FPDFBookmark_GetFirstChild: (arg0: Ptr, arg1: Ptr) => Ptr;
  FPDFBookmark_GetNextSibling: (arg0: Ptr, arg1: Ptr) => Ptr;
  FPDFBookmark_GetTitle: (arg0: Ptr, arg1: Ptr, arg2: number) => number;
  FPDFCatalog_GetLanguage: (arg0: Ptr, arg1: Ptr, arg2: number) => number;
  FPDFCatalog_IsTagged: (arg0: Ptr) => boolean;
  FPDFCatalog_SetLanguage: (arg0: Ptr, arg1: Ptr) => boolean;
  FPDFClipPath_CountPaths: (arg0: Ptr) => number;
  FPDFClipPath_CountPathSegments: (arg0: Ptr, arg1: number) => number;
  FPDFClipPath_GetPathSegment: (arg0: Ptr, arg1: number, arg2: number) => Ptr;
  FPDFDest_GetDestPageIndex: (arg0: Ptr, arg1: Ptr) => number;
  FPDFDest_GetLocationInPage: (
    arg0: Ptr,
    arg1: boolean,
    arg2: boolean,
    arg3: boolean,
    arg4: Ptr,
    arg5: Ptr,
    arg6: Ptr,
  ) => boolean;
  FPDFDest_GetView: (arg0: Ptr, arg1: Ptr, arg2: Ptr) => number;
  FPDFDoc_AddAttachment: (arg0: Ptr, arg1: Ptr) => Ptr;
  FPDFDoc_CloseJavaScriptAction: (arg0: Ptr) => void;
  FPDFDoc_DeleteAttachment: (arg0: Ptr, arg1: number) => boolean;
  FPDFDOC_ExitFormFillEnvironment: (arg0: Ptr) => void;
  FPDFDoc_GetAttachment: (arg0: Ptr, arg1: number) => Ptr;
  FPDFDoc_GetAttachmentCount: (arg0: Ptr) => number;
  FPDFDoc_GetJavaScriptAction: (arg0: Ptr, arg1: number) => Ptr;
  FPDFDoc_GetJavaScriptActionCount: (arg0: Ptr) => number;
  FPDFDoc_GetPageMode: (arg0: Ptr) => number;
  FPDFDOC_InitFormFillEnvironment: (arg0: Ptr, arg1: Ptr) => Ptr;
  FPDFFont_Close: (arg0: Ptr) => void;
  FPDFFont_GetAscent: (arg0: Ptr, arg1: number, arg2: number) => boolean;
  FPDFFont_GetBaseFontName: (arg0: Ptr, arg1: Ptr, arg2: bigint) => bigint;
  FPDFFont_GetDescent: (arg0: Ptr, arg1: number, arg2: number) => boolean;
  FPDFFont_GetFamilyName: (arg0: Ptr, arg1: Ptr, arg2: bigint) => bigint;
  FPDFFont_GetFlags: (arg0: Ptr) => number;
  FPDFFont_GetFontData: (arg0: Ptr, arg1: Ptr, arg2: bigint, arg3: bigint) => boolean;
  FPDFFont_GetGlyphPath: (arg0: Ptr, arg1: number, arg2: number) => Ptr;
  FPDFFont_GetGlyphWidth: (arg0: Ptr, arg1: number, arg2: number, arg3: number) => boolean;
  FPDFFont_GetIsEmbedded: (arg0: Ptr) => number;
  FPDFFont_GetItalicAngle: (arg0: Ptr, arg1: Ptr) => boolean;
  FPDFFont_GetWeight: (arg0: Ptr) => number;
  FPDFFormObj_CountObjects: (arg0: Ptr) => number;
  FPDFFormObj_GetObject: (arg0: Ptr, arg1: number) => Ptr;
  FPDFFormObj_RemoveObject: (arg0: Ptr, arg1: Ptr) => boolean;
  FPDFGlyphPath_CountGlyphSegments: (arg0: Ptr) => number;
  FPDFGlyphPath_GetGlyphPathSegment: (arg0: Ptr, arg1: number) => Ptr;
  FPDFImageObj_GetBitmap: (arg0: Ptr) => Ptr;
  FPDFImageObj_GetIccProfileDataDecoded: (
    arg0: Ptr,
    arg1: Ptr,
    arg2: Ptr,
    arg3: bigint,
    arg4: bigint,
  ) => boolean;
  FPDFImageObj_GetImageDataDecoded: (arg0: Ptr, arg1: Ptr, arg2: number) => number;
  FPDFImageObj_GetImageDataRaw: (arg0: Ptr, arg1: Ptr, arg2: number) => number;
  FPDFImageObj_GetImageFilter: (arg0: Ptr, arg1: number, arg2: Ptr, arg3: number) => number;
  FPDFImageObj_GetImageFilterCount: (arg0: Ptr) => number;
  FPDFImageObj_GetImageMetadata: (arg0: Ptr, arg1: Ptr, arg2: Ptr) => boolean;
  FPDFImageObj_GetImagePixelSize: (arg0: Ptr, arg1: Ptr, arg2: Ptr) => boolean;
  FPDFImageObj_GetRenderedBitmap: (arg0: Ptr, arg1: Ptr, arg2: Ptr) => Ptr;
  FPDFImageObj_LoadJpegFile: (arg0: Ptr, arg1: number, arg2: Ptr, arg3: Ptr) => boolean;
  FPDFImageObj_LoadJpegFileInline: (arg0: Ptr, arg1: number, arg2: Ptr, arg3: Ptr) => boolean;
  FPDFImageObj_SetBitmap: (arg0: Ptr, arg1: number, arg2: Ptr, arg3: Ptr) => boolean;
  FPDFImageObj_SetMatrix: (
    arg0: Ptr,
    arg1: number,
    arg2: number,
    arg3: number,
    arg4: number,
    arg5: number,
    arg6: number,
  ) => boolean;
  FPDFJavaScriptAction_GetName: (arg0: Ptr, arg1: Ptr, arg2: number) => number;
  FPDFJavaScriptAction_GetScript: (arg0: Ptr, arg1: Ptr, arg2: number) => number;
  FPDFLink_CloseWebLinks: (arg0: Ptr) => void;
  FPDFLink_CountQuadPoints: (arg0: Ptr) => number;
  FPDFLink_CountRects: (arg0: Ptr, arg1: number) => number;
  FPDFLink_CountWebLinks: (arg0: Ptr) => number;
  FPDFLink_Enumerate: (arg0: Ptr, arg1: Ptr, arg2: Ptr) => boolean;
  FPDFLink_GetAction: (arg0: Ptr) => Ptr;
  FPDFLink_GetAnnot: (arg0: Ptr, arg1: Ptr) => Ptr;
  FPDFLink_GetAnnotRect: (arg0: Ptr, arg1: Ptr) => boolean;
  FPDFLink_GetDest: (arg0: Ptr, arg1: Ptr) => Ptr;
  FPDFLink_GetLinkAtPoint: (arg0: Ptr, arg1: number, arg2: number) => Ptr;
  FPDFLink_GetLinkZOrderAtPoint: (arg0: Ptr, arg1: number, arg2: number) => number;
  FPDFLink_GetQuadPoints: (arg0: Ptr, arg1: number, arg2: Ptr) => boolean;
  FPDFLink_GetRect: (
    arg0: Ptr,
    arg1: number,
    arg2: number,
    arg3: number,
    arg4: number,
    arg5: number,
    arg6: number,
  ) => boolean;
  FPDFLink_GetTextRange: (arg0: Ptr, arg1: number, arg2: Ptr, arg3: Ptr) => boolean;
  FPDFLink_GetURL: (arg0: Ptr, arg1: number, arg2: Ptr, arg3: number) => number;
  FPDFLink_LoadWebLinks: (arg0: Ptr) => Ptr;
  FPDFPage_CloseAnnot: (arg0: Ptr) => void;
  FPDFPage_CountObjects: (arg0: Ptr) => number;
  FPDFPage_CreateAnnot: (arg0: Ptr, arg1: Ptr) => Ptr;
  FPDFPage_Delete: (arg0: Ptr, arg1: number) => void;
  FPDFPage_Flatten: (arg0: Ptr, arg1: number) => number;
  FPDFPage_FormFieldZOrderAtPoint: (arg0: Ptr, arg1: Ptr, arg2: number, arg3: number) => number;
  FPDFPage_GenerateContent: (arg0: Ptr) => boolean;
  FPDFPage_GetAnnot: (arg0: Ptr, arg1: number) => Ptr;
  FPDFPage_GetAnnotCount: (arg0: Ptr) => number;
  FPDFPage_GetAnnotIndex: (arg0: Ptr, arg1: Ptr) => number;
  FPDFPage_GetArtBox: (
    arg0: Ptr,
    arg1: number,
    arg2: number,
    arg3: number,
    arg4: number,
  ) => boolean;
  FPDFPage_GetBleedBox: (
    arg0: Ptr,
    arg1: number,
    arg2: number,
    arg3: number,
    arg4: number,
  ) => boolean;
  FPDFPage_GetCropBox: (
    arg0: Ptr,
    arg1: number,
    arg2: number,
    arg3: number,
    arg4: number,
  ) => boolean;
  FPDFPage_GetDecodedThumbnailData: (arg0: Ptr, arg1: Ptr, arg2: number) => number;
  FPDFPage_GetMediaBox: (
    arg0: Ptr,
    arg1: number,
    arg2: number,
    arg3: number,
    arg4: number,
  ) => boolean;
  FPDFPage_GetObject: (arg0: Ptr, arg1: number) => Ptr;
  FPDFPage_GetRawThumbnailData: (arg0: Ptr, arg1: Ptr, arg2: number) => number;
  FPDFPage_GetRotation: (arg0: Ptr) => number;
  FPDFPage_GetThumbnailAsBitmap: (arg0: Ptr) => Ptr;
  FPDFPage_GetTrimBox: (
    arg0: Ptr,
    arg1: number,
    arg2: number,
    arg3: number,
    arg4: number,
  ) => boolean;
  FPDFPage_HasFormFieldAtPoint: (arg0: Ptr, arg1: Ptr, arg2: number, arg3: number) => number;
  FPDFPage_HasTransparency: (arg0: Ptr) => boolean;
  FPDFPage_InsertClipPath: (arg0: Ptr, arg1: Ptr) => void;
  FPDFPage_InsertObject: (arg0: Ptr, arg1: Ptr) => void;
  FPDFPage_InsertObjectAtIndex: (arg0: Ptr, arg1: Ptr, arg2: bigint) => boolean;
  FPDFPage_New: (arg0: Ptr, arg1: number, arg2: number, arg3: number) => Ptr;
  FPDFPage_RemoveAnnot: (arg0: Ptr, arg1: number) => boolean;
  FPDFPage_RemoveObject: (arg0: Ptr, arg1: Ptr) => boolean;
  FPDFPage_SetArtBox: (arg0: Ptr, arg1: number, arg2: number, arg3: number, arg4: number) => void;
  FPDFPage_SetBleedBox: (arg0: Ptr, arg1: number, arg2: number, arg3: number, arg4: number) => void;
  FPDFPage_SetCropBox: (arg0: Ptr, arg1: number, arg2: number, arg3: number, arg4: number) => void;
  FPDFPage_SetMediaBox: (arg0: Ptr, arg1: number, arg2: number, arg3: number, arg4: number) => void;
  FPDFPage_SetRotation: (arg0: Ptr, arg1: number) => void;
  FPDFPage_SetTrimBox: (arg0: Ptr, arg1: number, arg2: number, arg3: number, arg4: number) => void;
  FPDFPage_TransformAnnots: (
    arg0: Ptr,
    arg1: number,
    arg2: number,
    arg3: number,
    arg4: number,
    arg5: number,
    arg6: number,
  ) => void;
  FPDFPage_TransFormWithClip: (arg0: Ptr, arg1: Ptr, arg2: Ptr) => boolean;
  FPDFPageObj_AddMark: (arg0: Ptr, arg1: string) => Ptr;
  FPDFPageObj_CountMarks: (arg0: Ptr) => number;
  FPDFPageObj_CreateNewPath: (arg0: number, arg1: number) => Ptr;
  FPDFPageObj_CreateNewRect: (arg0: number, arg1: number, arg2: number, arg3: number) => Ptr;
  FPDFPageObj_CreateTextObj: (arg0: Ptr, arg1: Ptr, arg2: number) => Ptr;
  FPDFPageObj_Destroy: (arg0: Ptr) => void;
  FPDFPageObj_GetBounds: (
    arg0: Ptr,
    arg1: number,
    arg2: number,
    arg3: number,
    arg4: number,
  ) => boolean;
  FPDFPageObj_GetClipPath: (arg0: Ptr) => Ptr;
  FPDFPageObj_GetDashArray: (arg0: Ptr, arg1: number, arg2: bigint) => boolean;
  FPDFPageObj_GetDashCount: (arg0: Ptr) => number;
  FPDFPageObj_GetDashPhase: (arg0: Ptr, arg1: number) => boolean;
  FPDFPageObj_GetFillColor: (arg0: Ptr, arg1: Ptr, arg2: Ptr, arg3: Ptr, arg4: Ptr) => boolean;
  FPDFPageObj_GetIsActive: (arg0: Ptr, arg1: boolean) => boolean;
  FPDFPageObj_GetLineCap: (arg0: Ptr) => number;
  FPDFPageObj_GetLineJoin: (arg0: Ptr) => number;
  FPDFPageObj_GetMark: (arg0: Ptr, arg1: number) => Ptr;
  FPDFPageObj_GetMarkedContentID: (arg0: Ptr) => number;
  FPDFPageObj_GetMatrix: (arg0: Ptr, arg1: Ptr) => boolean;
  FPDFPageObj_GetRotatedBounds: (arg0: Ptr, arg1: Ptr) => boolean;
  FPDFPageObj_GetStrokeColor: (arg0: Ptr, arg1: Ptr, arg2: Ptr, arg3: Ptr, arg4: Ptr) => boolean;
  FPDFPageObj_GetStrokeWidth: (arg0: Ptr, arg1: number) => boolean;
  FPDFPageObj_GetType: (arg0: Ptr) => number;
  FPDFPageObj_HasTransparency: (arg0: Ptr) => boolean;
  FPDFPageObj_NewImageObj: (arg0: Ptr) => Ptr;
  FPDFPageObj_NewTextObj: (arg0: Ptr, arg1: string, arg2: number) => Ptr;
  FPDFPageObj_RemoveMark: (arg0: Ptr, arg1: Ptr) => boolean;
  FPDFPageObj_SetBlendMode: (arg0: Ptr, arg1: string) => void;
  FPDFPageObj_SetDashArray: (arg0: Ptr, arg1: number, arg2: bigint, arg3: number) => boolean;
  FPDFPageObj_SetDashPhase: (arg0: Ptr, arg1: number) => boolean;
  FPDFPageObj_SetFillColor: (
    arg0: Ptr,
    arg1: number,
    arg2: number,
    arg3: number,
    arg4: number,
  ) => boolean;
  FPDFPageObj_SetIsActive: (arg0: Ptr, arg1: boolean) => boolean;
  FPDFPageObj_SetLineCap: (arg0: Ptr, arg1: number) => boolean;
  FPDFPageObj_SetLineJoin: (arg0: Ptr, arg1: number) => boolean;
  FPDFPageObj_SetMatrix: (arg0: Ptr, arg1: Ptr) => boolean;
  FPDFPageObj_SetStrokeColor: (
    arg0: Ptr,
    arg1: number,
    arg2: number,
    arg3: number,
    arg4: number,
  ) => boolean;
  FPDFPageObj_SetStrokeWidth: (arg0: Ptr, arg1: number) => boolean;
  FPDFPageObj_Transform: (
    arg0: Ptr,
    arg1: number,
    arg2: number,
    arg3: number,
    arg4: number,
    arg5: number,
    arg6: number,
  ) => void;
  FPDFPageObj_TransformClipPath: (
    arg0: Ptr,
    arg1: number,
    arg2: number,
    arg3: number,
    arg4: number,
    arg5: number,
    arg6: number,
  ) => void;
  FPDFPageObj_TransformF: (arg0: Ptr, arg1: Ptr) => boolean;
  FPDFPageObjMark_CountParams: (arg0: Ptr) => number;
  FPDFPageObjMark_GetName: (arg0: Ptr, arg1: Ptr, arg2: number, arg3: Ptr) => boolean;
  FPDFPageObjMark_GetParamBlobValue: (
    arg0: Ptr,
    arg1: string,
    arg2: Ptr,
    arg3: number,
    arg4: Ptr,
  ) => boolean;
  FPDFPageObjMark_GetParamFloatValue: (arg0: Ptr, arg1: string, arg2: number) => boolean;
  FPDFPageObjMark_GetParamIntValue: (arg0: Ptr, arg1: string, arg2: Ptr) => boolean;
  FPDFPageObjMark_GetParamKey: (
    arg0: Ptr,
    arg1: number,
    arg2: Ptr,
    arg3: number,
    arg4: Ptr,
  ) => boolean;
  FPDFPageObjMark_GetParamStringValue: (
    arg0: Ptr,
    arg1: string,
    arg2: Ptr,
    arg3: number,
    arg4: Ptr,
  ) => boolean;
  FPDFPageObjMark_GetParamValueType: (arg0: Ptr, arg1: string) => Ptr;
  FPDFPageObjMark_RemoveParam: (arg0: Ptr, arg1: Ptr, arg2: string) => boolean;
  FPDFPageObjMark_SetBlobParam: (
    arg0: Ptr,
    arg1: Ptr,
    arg2: Ptr,
    arg3: string,
    arg4: Ptr,
    arg5: number,
  ) => boolean;
  FPDFPageObjMark_SetFloatParam: (
    arg0: Ptr,
    arg1: Ptr,
    arg2: Ptr,
    arg3: string,
    arg4: number,
  ) => boolean;
  FPDFPageObjMark_SetIntParam: (
    arg0: Ptr,
    arg1: Ptr,
    arg2: Ptr,
    arg3: string,
    arg4: number,
  ) => boolean;
  FPDFPageObjMark_SetStringParam: (
    arg0: Ptr,
    arg1: Ptr,
    arg2: Ptr,
    arg3: string,
    arg4: string,
  ) => boolean;
  FPDFPath_BezierTo: (
    arg0: Ptr,
    arg1: number,
    arg2: number,
    arg3: number,
    arg4: number,
    arg5: number,
    arg6: number,
  ) => boolean;
  FPDFPath_Close: (arg0: Ptr) => boolean;
  FPDFPath_CountSegments: (arg0: Ptr) => number;
  FPDFPath_GetDrawMode: (arg0: Ptr, arg1: Ptr, arg2: boolean) => boolean;
  FPDFPath_GetPathSegment: (arg0: Ptr, arg1: number) => Ptr;
  FPDFPath_LineTo: (arg0: Ptr, arg1: number, arg2: number) => boolean;
  FPDFPath_MoveTo: (arg0: Ptr, arg1: number, arg2: number) => boolean;
  FPDFPath_SetDrawMode: (arg0: Ptr, arg1: number, arg2: boolean) => boolean;
  FPDFPathSegment_GetClose: (arg0: Ptr) => boolean;
  FPDFPathSegment_GetPoint: (arg0: Ptr, arg1: number, arg2: number) => boolean;
  FPDFPathSegment_GetType: (arg0: Ptr) => number;
  FPDFSignatureObj_GetByteRange: (arg0: Ptr, arg1: Ptr, arg2: number) => number;
  FPDFSignatureObj_GetContents: (arg0: Ptr, arg1: Ptr, arg2: number) => number;
  FPDFSignatureObj_GetDocMDPPermission: (arg0: Ptr) => number;
  FPDFSignatureObj_GetReason: (arg0: Ptr, arg1: Ptr, arg2: number) => number;
  FPDFSignatureObj_GetSubFilter: (arg0: Ptr, arg1: Ptr, arg2: number) => number;
  FPDFSignatureObj_GetTime: (arg0: Ptr, arg1: Ptr, arg2: number) => number;
  FPDFText_ClosePage: (arg0: Ptr) => void;
  FPDFText_CountChars: (arg0: Ptr) => number;
  FPDFText_CountRects: (arg0: Ptr, arg1: number, arg2: number) => number;
  FPDFText_FindClose: (arg0: Ptr) => void;
  FPDFText_FindNext: (arg0: Ptr) => boolean;
  FPDFText_FindPrev: (arg0: Ptr) => boolean;
  FPDFText_FindStart: (arg0: Ptr, arg1: Ptr, arg2: number, arg3: number) => Ptr;
  FPDFText_GetBoundedText: (
    arg0: Ptr,
    arg1: number,
    arg2: number,
    arg3: number,
    arg4: number,
    arg5: Ptr,
    arg6: number,
  ) => number;
  FPDFText_GetCharAngle: (arg0: Ptr, arg1: number) => number;
  FPDFText_GetCharBox: (
    arg0: Ptr,
    arg1: number,
    arg2: number,
    arg3: number,
    arg4: number,
    arg5: number,
  ) => boolean;
  FPDFText_GetCharIndexAtPos: (
    arg0: Ptr,
    arg1: number,
    arg2: number,
    arg3: number,
    arg4: number,
  ) => number;
  FPDFText_GetCharIndexFromTextIndex: (arg0: Ptr, arg1: number) => number;
  FPDFText_GetCharOrigin: (arg0: Ptr, arg1: number, arg2: number, arg3: number) => boolean;
  FPDFText_GetFillColor: (
    arg0: Ptr,
    arg1: number,
    arg2: Ptr,
    arg3: Ptr,
    arg4: Ptr,
    arg5: Ptr,
  ) => boolean;
  FPDFText_GetFontInfo: (arg0: Ptr, arg1: number, arg2: Ptr, arg3: number, arg4: Ptr) => number;
  FPDFText_GetFontSize: (arg0: Ptr, arg1: number) => number;
  FPDFText_GetFontWeight: (arg0: Ptr, arg1: number) => number;
  FPDFText_GetLooseCharBox: (arg0: Ptr, arg1: number, arg2: Ptr) => boolean;
  FPDFText_GetMatrix: (arg0: Ptr, arg1: number, arg2: Ptr) => boolean;
  FPDFText_GetRect: (
    arg0: Ptr,
    arg1: number,
    arg2: number,
    arg3: number,
    arg4: number,
    arg5: number,
  ) => boolean;
  FPDFText_GetSchCount: (arg0: Ptr) => number;
  FPDFText_GetSchResultIndex: (arg0: Ptr) => number;
  FPDFText_GetStrokeColor: (
    arg0: Ptr,
    arg1: number,
    arg2: Ptr,
    arg3: Ptr,
    arg4: Ptr,
    arg5: Ptr,
  ) => boolean;
  FPDFText_GetText: (arg0: Ptr, arg1: number, arg2: number, arg3: Ptr) => number;
  FPDFText_GetTextIndexFromCharIndex: (arg0: Ptr, arg1: number) => number;
  FPDFText_GetTextObject: (arg0: Ptr, arg1: number) => Ptr;
  FPDFText_GetUnicode: (arg0: Ptr, arg1: number) => number;
  FPDFText_HasUnicodeMapError: (arg0: Ptr, arg1: number) => number;
  FPDFText_IsGenerated: (arg0: Ptr, arg1: number) => number;
  FPDFText_IsHyphen: (arg0: Ptr, arg1: number) => number;
  FPDFText_LoadCidType2Font: (
    arg0: Ptr,
    arg1: Ptr,
    arg2: number,
    arg3: string,
    arg4: Ptr,
    arg5: number,
  ) => Ptr;
  FPDFText_LoadFont: (arg0: Ptr, arg1: Ptr, arg2: number, arg3: number, arg4: boolean) => Ptr;
  FPDFText_LoadPage: (arg0: Ptr) => Ptr;
  FPDFText_LoadStandardFont: (arg0: Ptr, arg1: string) => Ptr;
  FPDFText_SetCharcodes: (arg0: Ptr, arg1: Ptr, arg2: bigint) => boolean;
  FPDFText_SetText: (arg0: Ptr, arg1: Ptr) => boolean;
  FPDFTextObj_GetFont: (arg0: Ptr) => Ptr;
  FPDFTextObj_GetFontSize: (arg0: Ptr, arg1: number) => boolean;
  FPDFTextObj_GetRenderedBitmap: (arg0: Ptr, arg1: Ptr, arg2: Ptr, arg3: number) => Ptr;
  FPDFTextObj_GetText: (arg0: Ptr, arg1: Ptr, arg2: Ptr, arg3: number) => number;
  FPDFTextObj_GetTextRenderMode: (arg0: Ptr) => Ptr;
  FPDFTextObj_SetTextRenderMode: (arg0: Ptr, arg1: Ptr) => boolean;
}

export const pdfFunctionSignatures = {
  EPDF_GetMetaKeyCount: { params: ['Ptr', 'boolean'], result: 'number' },
  EPDF_GetMetaKeyName: { params: ['Ptr', 'number', 'boolean', 'Ptr', 'number'], result: 'number' },
  EPDF_GetMetaTrapped: { params: ['Ptr'], result: 'Ptr' },
  EPDF_GetPageRotationByIndex: { params: ['Ptr', 'number'], result: 'number' },
  EPDF_GetPageSizeByIndexNormalized: { params: ['Ptr', 'number', 'Ptr'], result: 'boolean' },
  EPDF_HasMetaText: { params: ['Ptr', 'string'], result: 'boolean' },
  EPDF_IsEncrypted: { params: ['Ptr'], result: 'boolean' },
  EPDF_IsOwnerUnlocked: { params: ['Ptr'], result: 'boolean' },
  EPDF_LoadPageNormalized: { params: ['Ptr', 'number', 'Ptr'], result: 'Ptr' },
  EPDF_PNG_EncodeRGBA: {
    params: ['Ptr', 'number', 'number', 'number', 'number', 'Ptr'],
    result: 'bigint',
  },
  EPDF_RemoveEncryption: { params: ['Ptr'], result: 'boolean' },
  EPDF_RenderAnnotBitmap: {
    params: ['Ptr', 'Ptr', 'Ptr', 'Ptr', 'Ptr', 'number'],
    result: 'boolean',
  },
  EPDF_RenderAnnotBitmapUnrotated: {
    params: ['Ptr', 'Ptr', 'Ptr', 'Ptr', 'Ptr', 'number'],
    result: 'boolean',
  },
  EPDF_SetEncryption: { params: ['Ptr', 'string', 'string', 'number'], result: 'boolean' },
  EPDF_SetMetaText: { params: ['Ptr', 'string', 'Ptr'], result: 'boolean' },
  EPDF_SetMetaTrapped: { params: ['Ptr', 'Ptr'], result: 'boolean' },
  EPDF_UnlockOwnerPermissions: { params: ['Ptr', 'string'], result: 'boolean' },
  EPDFAction_CreateGoTo: { params: ['Ptr', 'Ptr'], result: 'Ptr' },
  EPDFAction_CreateGoToNamed: { params: ['Ptr', 'string'], result: 'Ptr' },
  EPDFAction_CreateLaunch: { params: ['Ptr', 'Ptr'], result: 'Ptr' },
  EPDFAction_CreateRemoteGoToByName: { params: ['Ptr', 'Ptr', 'Ptr'], result: 'Ptr' },
  EPDFAction_CreateRemoteGoToDest: { params: ['Ptr', 'Ptr', 'Ptr'], result: 'Ptr' },
  EPDFAction_CreateURI: { params: ['Ptr', 'string'], result: 'Ptr' },
  EPDFAnnot_ApplyRedaction: { params: ['Ptr', 'Ptr'], result: 'boolean' },
  EPDFAnnot_ClearBorderEffect: { params: ['Ptr'], result: 'boolean' },
  EPDFAnnot_ClearColor: { params: ['Ptr', 'number'], result: 'boolean' },
  EPDFAnnot_ClearMKColor: { params: ['Ptr', 'number'], result: 'boolean' },
  EPDFAnnot_ClearRectangleDifferences: { params: ['Ptr'], result: 'boolean' },
  EPDFAnnot_ExportAppearanceAsDocument: { params: ['Ptr'], result: 'Ptr' },
  EPDFAnnot_ExportMultipleAppearancesAsDocument: { params: ['Ptr', 'number'], result: 'Ptr' },
  EPDFAnnot_Flatten: { params: ['Ptr', 'Ptr'], result: 'boolean' },
  EPDFAnnot_GenerateAppearance: { params: ['Ptr'], result: 'boolean' },
  EPDFAnnot_GenerateAppearanceWithBlend: { params: ['Ptr', 'Ptr'], result: 'boolean' },
  EPDFAnnot_GenerateFormFieldAP: { params: ['Ptr'], result: 'boolean' },
  EPDFAnnot_GetAPMatrix: { params: ['Ptr', 'Ptr', 'Ptr'], result: 'boolean' },
  EPDFAnnot_GetAvailableAppearanceModes: { params: ['Ptr'], result: 'number' },
  EPDFAnnot_GetBlendMode: { params: ['Ptr'], result: 'Ptr' },
  EPDFAnnot_GetBorderDashPattern: { params: ['Ptr', 'number', 'number'], result: 'boolean' },
  EPDFAnnot_GetBorderDashPatternCount: { params: ['Ptr'], result: 'number' },
  EPDFAnnot_GetBorderEffect: { params: ['Ptr', 'number'], result: 'boolean' },
  EPDFAnnot_GetBorderStyle: { params: ['Ptr', 'number'], result: 'Ptr' },
  EPDFAnnot_GetButtonExportValue: { params: ['Ptr', 'Ptr', 'number'], result: 'number' },
  EPDFAnnot_GetCalloutLine: { params: ['Ptr', 'Ptr', 'number'], result: 'number' },
  EPDFAnnot_GetCalloutLineCount: { params: ['Ptr'], result: 'number' },
  EPDFAnnot_GetColor: { params: ['Ptr', 'number', 'Ptr', 'Ptr', 'Ptr'], result: 'boolean' },
  EPDFAnnot_GetDefaultAppearance: {
    params: ['Ptr', 'Ptr', 'number', 'Ptr', 'Ptr', 'Ptr'],
    result: 'boolean',
  },
  EPDFAnnot_GetExtendedRotation: { params: ['Ptr', 'number'], result: 'boolean' },
  EPDFAnnot_GetFormFieldObjectNumber: { params: ['Ptr', 'Ptr'], result: 'number' },
  EPDFAnnot_GetFormFieldRawValue: { params: ['Ptr', 'Ptr', 'Ptr', 'number'], result: 'number' },
  EPDFAnnot_GetIntent: { params: ['Ptr', 'Ptr', 'number'], result: 'number' },
  EPDFAnnot_GetLineEndings: { params: ['Ptr', 'Ptr', 'Ptr'], result: 'boolean' },
  EPDFAnnot_GetMKColor: { params: ['Ptr', 'number', 'Ptr', 'Ptr', 'Ptr'], result: 'boolean' },
  EPDFAnnot_GetName: { params: ['Ptr'], result: 'Ptr' },
  EPDFAnnot_GetOpacity: { params: ['Ptr', 'Ptr'], result: 'boolean' },
  EPDFAnnot_GetOverlayText: { params: ['Ptr', 'Ptr', 'number'], result: 'number' },
  EPDFAnnot_GetOverlayTextRepeat: { params: ['Ptr'], result: 'boolean' },
  EPDFAnnot_GetRect: { params: ['Ptr', 'Ptr'], result: 'boolean' },
  EPDFAnnot_GetRectangleDifferences: {
    params: ['Ptr', 'number', 'number', 'number', 'number'],
    result: 'boolean',
  },
  EPDFAnnot_GetReplyType: { params: ['Ptr'], result: 'Ptr' },
  EPDFAnnot_GetRichContent: { params: ['Ptr', 'Ptr', 'number'], result: 'number' },
  EPDFAnnot_GetRotate: { params: ['Ptr', 'number'], result: 'boolean' },
  EPDFAnnot_GetTextAlignment: { params: ['Ptr'], result: 'Ptr' },
  EPDFAnnot_GetUnrotatedRect: { params: ['Ptr', 'Ptr'], result: 'boolean' },
  EPDFAnnot_GetVerticalAlignment: { params: ['Ptr'], result: 'Ptr' },
  EPDFAnnot_HasAppearanceStream: { params: ['Ptr', 'Ptr'], result: 'boolean' },
  EPDFAnnot_SetAction: { params: ['Ptr', 'Ptr'], result: 'boolean' },
  EPDFAnnot_SetAPMatrix: { params: ['Ptr', 'Ptr', 'Ptr'], result: 'boolean' },
  EPDFAnnot_SetAppearanceFromPage: { params: ['Ptr', 'Ptr', 'number'], result: 'boolean' },
  EPDFAnnot_SetBorderDashPattern: { params: ['Ptr', 'number', 'number'], result: 'boolean' },
  EPDFAnnot_SetBorderEffect: { params: ['Ptr', 'number'], result: 'boolean' },
  EPDFAnnot_SetBorderStyle: { params: ['Ptr', 'Ptr', 'number'], result: 'boolean' },
  EPDFAnnot_SetCalloutLine: { params: ['Ptr', 'Ptr', 'number'], result: 'boolean' },
  EPDFAnnot_SetColor: {
    params: ['Ptr', 'number', 'number', 'number', 'number'],
    result: 'boolean',
  },
  EPDFAnnot_SetDefaultAppearance: {
    params: ['Ptr', 'Ptr', 'number', 'number', 'number', 'number'],
    result: 'boolean',
  },
  EPDFAnnot_SetExtendedRotation: { params: ['Ptr', 'number'], result: 'boolean' },
  EPDFAnnot_SetFormFieldName: { params: ['Ptr', 'Ptr', 'Ptr'], result: 'boolean' },
  EPDFAnnot_SetFormFieldOptions: { params: ['Ptr', 'Ptr', 'Ptr', 'number'], result: 'boolean' },
  EPDFAnnot_SetFormFieldValue: { params: ['Ptr', 'Ptr', 'Ptr'], result: 'boolean' },
  EPDFAnnot_SetIntent: { params: ['Ptr', 'string'], result: 'boolean' },
  EPDFAnnot_SetLine: { params: ['Ptr', 'Ptr', 'Ptr'], result: 'boolean' },
  EPDFAnnot_SetLineEndings: { params: ['Ptr', 'Ptr', 'Ptr'], result: 'boolean' },
  EPDFAnnot_SetLinkedAnnot: { params: ['Ptr', 'string', 'Ptr'], result: 'boolean' },
  EPDFAnnot_SetMKColor: {
    params: ['Ptr', 'number', 'number', 'number', 'number'],
    result: 'boolean',
  },
  EPDFAnnot_SetName: { params: ['Ptr', 'Ptr'], result: 'boolean' },
  EPDFAnnot_SetNumberValue: { params: ['Ptr', 'string', 'number'], result: 'boolean' },
  EPDFAnnot_SetOpacity: { params: ['Ptr', 'number'], result: 'boolean' },
  EPDFAnnot_SetOverlayText: { params: ['Ptr', 'Ptr'], result: 'boolean' },
  EPDFAnnot_SetOverlayTextRepeat: { params: ['Ptr', 'boolean'], result: 'boolean' },
  EPDFAnnot_SetRectangleDifferences: {
    params: ['Ptr', 'number', 'number', 'number', 'number'],
    result: 'boolean',
  },
  EPDFAnnot_SetReplyType: { params: ['Ptr', 'Ptr'], result: 'boolean' },
  EPDFAnnot_SetRotate: { params: ['Ptr', 'number'], result: 'boolean' },
  EPDFAnnot_SetTextAlignment: { params: ['Ptr', 'Ptr'], result: 'boolean' },
  EPDFAnnot_SetUnrotatedRect: { params: ['Ptr', 'Ptr'], result: 'boolean' },
  EPDFAnnot_SetVerticalAlignment: { params: ['Ptr', 'Ptr'], result: 'boolean' },
  EPDFAnnot_SetVertices: { params: ['Ptr', 'Ptr', 'number'], result: 'boolean' },
  EPDFAnnot_ShareFormField: { params: ['Ptr', 'Ptr', 'Ptr'], result: 'boolean' },
  EPDFAnnot_UpdateAppearanceToRect: { params: ['Ptr', 'number'], result: 'boolean' },
  EPDFAttachment_GetDescription: { params: ['Ptr', 'Ptr', 'number'], result: 'number' },
  EPDFAttachment_GetIntegerValue: { params: ['Ptr', 'string', 'Ptr'], result: 'boolean' },
  EPDFAttachment_SetDescription: { params: ['Ptr', 'Ptr'], result: 'boolean' },
  EPDFAttachment_SetSubtype: { params: ['Ptr', 'string'], result: 'boolean' },
  EPDFBookmark_AppendChild: { params: ['Ptr', 'Ptr', 'Ptr'], result: 'Ptr' },
  EPDFBookmark_Clear: { params: ['Ptr'], result: 'boolean' },
  EPDFBookmark_ClearTarget: { params: ['Ptr'], result: 'boolean' },
  EPDFBookmark_Create: { params: ['Ptr', 'Ptr'], result: 'Ptr' },
  EPDFBookmark_Delete: { params: ['Ptr', 'Ptr'], result: 'boolean' },
  EPDFBookmark_InsertAfter: { params: ['Ptr', 'Ptr', 'Ptr', 'Ptr'], result: 'Ptr' },
  EPDFBookmark_SetAction: { params: ['Ptr', 'Ptr', 'Ptr'], result: 'boolean' },
  EPDFBookmark_SetDest: { params: ['Ptr', 'Ptr', 'Ptr'], result: 'boolean' },
  EPDFBookmark_SetTitle: { params: ['Ptr', 'Ptr'], result: 'boolean' },
  EPDFCatalog_GetLanguage: { params: ['Ptr', 'Ptr', 'number'], result: 'number' },
  EPDFDest_CreateRemoteView: {
    params: ['Ptr', 'number', 'number', 'Ptr', 'number'],
    result: 'Ptr',
  },
  EPDFDest_CreateRemoteXYZ: {
    params: ['Ptr', 'number', 'boolean', 'Ptr', 'boolean', 'Ptr', 'boolean', 'Ptr'],
    result: 'Ptr',
  },
  EPDFDest_CreateView: { params: ['Ptr', 'number', 'Ptr', 'number'], result: 'Ptr' },
  EPDFDest_CreateXYZ: {
    params: ['Ptr', 'boolean', 'Ptr', 'boolean', 'Ptr', 'boolean', 'Ptr'],
    result: 'Ptr',
  },
  EPDFImageObj_SetJpeg: { params: ['Ptr', 'number', 'Ptr', 'Ptr', 'bigint'], result: 'boolean' },
  EPDFImageObj_SetPng: { params: ['Ptr', 'number', 'Ptr', 'Ptr', 'bigint'], result: 'boolean' },
  EPDFNamedDest_Remove: { params: ['Ptr', 'string'], result: 'boolean' },
  EPDFNamedDest_SetDest: { params: ['Ptr', 'string', 'Ptr'], result: 'boolean' },
  EPDFPage_ApplyRedactions: { params: ['Ptr'], result: 'boolean' },
  EPDFPage_CreateAnnot: { params: ['Ptr', 'Ptr'], result: 'Ptr' },
  EPDFPage_CreateFormField: { params: ['Ptr', 'Ptr', 'number', 'Ptr'], result: 'Ptr' },
  EPDFPage_GetAnnotByName: { params: ['Ptr', 'Ptr'], result: 'Ptr' },
  EPDFPage_GetAnnotCountRaw: { params: ['Ptr', 'number'], result: 'number' },
  EPDFPage_GetAnnotRaw: { params: ['Ptr', 'number', 'number'], result: 'Ptr' },
  EPDFPage_RemoveAnnotByName: { params: ['Ptr', 'Ptr'], result: 'boolean' },
  EPDFPage_RemoveAnnotRaw: { params: ['Ptr', 'number', 'number'], result: 'boolean' },
  EPDFText_RedactInQuads: {
    params: ['Ptr', 'Ptr', 'bigint', 'boolean', 'boolean'],
    result: 'boolean',
  },
  EPDFText_RedactInRect: { params: ['Ptr', 'Ptr', 'boolean', 'boolean'], result: 'boolean' },
  FORM_CanRedo: { params: ['Ptr', 'Ptr'], result: 'boolean' },
  FORM_CanUndo: { params: ['Ptr', 'Ptr'], result: 'boolean' },
  FORM_DoDocumentAAction: { params: ['Ptr', 'number'], result: null },
  FORM_DoDocumentJSAction: { params: ['Ptr'], result: null },
  FORM_DoDocumentOpenAction: { params: ['Ptr'], result: null },
  FORM_DoPageAAction: { params: ['Ptr', 'Ptr', 'number'], result: null },
  FORM_ForceToKillFocus: { params: ['Ptr'], result: 'boolean' },
  FORM_GetFocusedAnnot: { params: ['Ptr', 'Ptr', 'Ptr'], result: 'boolean' },
  FORM_GetFocusedText: { params: ['Ptr', 'Ptr', 'Ptr', 'number'], result: 'number' },
  FORM_GetSelectedText: { params: ['Ptr', 'Ptr', 'Ptr', 'number'], result: 'number' },
  FORM_IsIndexSelected: { params: ['Ptr', 'Ptr', 'number'], result: 'boolean' },
  FORM_OnAfterLoadPage: { params: ['Ptr', 'Ptr'], result: null },
  FORM_OnBeforeClosePage: { params: ['Ptr', 'Ptr'], result: null },
  FORM_OnChar: { params: ['Ptr', 'Ptr', 'number', 'number'], result: 'boolean' },
  FORM_OnFocus: { params: ['Ptr', 'Ptr', 'number', 'number', 'number'], result: 'boolean' },
  FORM_OnKeyDown: { params: ['Ptr', 'Ptr', 'number', 'number'], result: 'boolean' },
  FORM_OnKeyUp: { params: ['Ptr', 'Ptr', 'number', 'number'], result: 'boolean' },
  FORM_OnLButtonDoubleClick: {
    params: ['Ptr', 'Ptr', 'number', 'number', 'number'],
    result: 'boolean',
  },
  FORM_OnLButtonDown: { params: ['Ptr', 'Ptr', 'number', 'number', 'number'], result: 'boolean' },
  FORM_OnLButtonUp: { params: ['Ptr', 'Ptr', 'number', 'number', 'number'], result: 'boolean' },
  FORM_OnMouseMove: { params: ['Ptr', 'Ptr', 'number', 'number', 'number'], result: 'boolean' },
  FORM_OnMouseWheel: {
    params: ['Ptr', 'Ptr', 'number', 'Ptr', 'number', 'number'],
    result: 'boolean',
  },
  FORM_OnRButtonDown: { params: ['Ptr', 'Ptr', 'number', 'number', 'number'], result: 'boolean' },
  FORM_OnRButtonUp: { params: ['Ptr', 'Ptr', 'number', 'number', 'number'], result: 'boolean' },
  FORM_Redo: { params: ['Ptr', 'Ptr'], result: 'boolean' },
  FORM_ReplaceAndKeepSelection: { params: ['Ptr', 'Ptr', 'Ptr'], result: null },
  FORM_ReplaceSelection: { params: ['Ptr', 'Ptr', 'Ptr'], result: null },
  FORM_SelectAllText: { params: ['Ptr', 'Ptr'], result: 'boolean' },
  FORM_SetFocusedAnnot: { params: ['Ptr', 'Ptr'], result: 'boolean' },
  FORM_SetIndexSelected: { params: ['Ptr', 'Ptr', 'number', 'boolean'], result: 'boolean' },
  FORM_Undo: { params: ['Ptr', 'Ptr'], result: 'boolean' },
  FPDF_AddInstalledFont: { params: ['Ptr', 'Ptr', 'number'], result: null },
  FPDF_CloseDocument: { params: ['Ptr'], result: null },
  FPDF_ClosePage: { params: ['Ptr'], result: null },
  FPDF_CloseXObject: { params: ['Ptr'], result: null },
  FPDF_CopyViewerPreferences: { params: ['Ptr', 'Ptr'], result: 'boolean' },
  FPDF_CountNamedDests: { params: ['Ptr'], result: 'Ptr' },
  FPDF_CreateClipPath: { params: ['number', 'number', 'number', 'number'], result: 'Ptr' },
  FPDF_CreateNewDocument: { params: [], result: 'Ptr' },
  FPDF_DestroyClipPath: { params: ['Ptr'], result: null },
  FPDF_DestroyLibrary: { params: [], result: null },
  FPDF_DeviceToPage: {
    params: [
      'Ptr',
      'number',
      'number',
      'number',
      'number',
      'number',
      'number',
      'number',
      'number',
      'number',
    ],
    result: 'boolean',
  },
  FPDF_DocumentHasValidCrossReferenceTable: { params: ['Ptr'], result: 'boolean' },
  FPDF_FFLDraw: {
    params: ['Ptr', 'Ptr', 'Ptr', 'number', 'number', 'number', 'number', 'number', 'number'],
    result: null,
  },
  FPDF_FreeDefaultSystemFontInfo: { params: ['Ptr'], result: null },
  FPDF_GetDefaultSystemFontInfo: { params: [], result: 'Ptr' },
  FPDF_GetDefaultTTFMap: { params: [], result: 'Ptr' },
  FPDF_GetDefaultTTFMapCount: { params: [], result: 'bigint' },
  FPDF_GetDefaultTTFMapEntry: { params: ['bigint'], result: 'Ptr' },
  FPDF_GetDocPermissions: { params: ['Ptr'], result: 'number' },
  FPDF_GetDocUserPermissions: { params: ['Ptr'], result: 'number' },
  FPDF_GetFileIdentifier: { params: ['Ptr', 'Ptr', 'Ptr', 'number'], result: 'number' },
  FPDF_GetFileVersion: { params: ['Ptr', 'Ptr'], result: 'boolean' },
  FPDF_GetFormType: { params: ['Ptr'], result: 'number' },
  FPDF_GetLastError: { params: [], result: 'number' },
  FPDF_GetMetaText: { params: ['Ptr', 'string', 'Ptr', 'number'], result: 'number' },
  FPDF_GetNamedDest: { params: ['Ptr', 'number', 'Ptr', 'Ptr'], result: 'Ptr' },
  FPDF_GetNamedDestByName: { params: ['Ptr', 'string'], result: 'Ptr' },
  FPDF_GetPageAAction: { params: ['Ptr', 'number'], result: 'Ptr' },
  FPDF_GetPageBoundingBox: { params: ['Ptr', 'Ptr'], result: 'boolean' },
  FPDF_GetPageCount: { params: ['Ptr'], result: 'number' },
  FPDF_GetPageHeight: { params: ['Ptr'], result: 'number' },
  FPDF_GetPageHeightF: { params: ['Ptr'], result: 'number' },
  FPDF_GetPageLabel: { params: ['Ptr', 'number', 'Ptr', 'number'], result: 'number' },
  FPDF_GetPageSizeByIndex: { params: ['Ptr', 'number', 'number', 'number'], result: 'number' },
  FPDF_GetPageSizeByIndexF: { params: ['Ptr', 'number', 'Ptr'], result: 'boolean' },
  FPDF_GetPageWidth: { params: ['Ptr'], result: 'number' },
  FPDF_GetPageWidthF: { params: ['Ptr'], result: 'number' },
  FPDF_GetSecurityHandlerRevision: { params: ['Ptr'], result: 'number' },
  FPDF_GetSignatureCount: { params: ['Ptr'], result: 'number' },
  FPDF_GetSignatureObject: { params: ['Ptr', 'number'], result: 'Ptr' },
  FPDF_GetTrailerEnds: { params: ['Ptr', 'Ptr', 'number'], result: 'number' },
  FPDF_GetXFAPacketContent: {
    params: ['Ptr', 'number', 'Ptr', 'number', 'Ptr'],
    result: 'boolean',
  },
  FPDF_GetXFAPacketCount: { params: ['Ptr'], result: 'number' },
  FPDF_GetXFAPacketName: { params: ['Ptr', 'number', 'Ptr', 'number'], result: 'number' },
  FPDF_ImportNPagesToOne: {
    params: ['Ptr', 'number', 'number', 'bigint', 'bigint'],
    result: 'Ptr',
  },
  FPDF_ImportPages: { params: ['Ptr', 'Ptr', 'string', 'number'], result: 'boolean' },
  FPDF_ImportPagesByIndex: { params: ['Ptr', 'Ptr', 'Ptr', 'number', 'number'], result: 'boolean' },
  FPDF_InitLibrary: { params: [], result: null },
  FPDF_InitLibraryWithConfig: { params: ['Ptr'], result: null },
  FPDF_LoadCustomDocument: { params: ['Ptr', 'string'], result: 'Ptr' },
  FPDF_LoadDocument: { params: ['Ptr', 'string'], result: 'Ptr' },
  FPDF_LoadMemDocument: { params: ['Ptr', 'number', 'string'], result: 'Ptr' },
  FPDF_LoadMemDocument64: { params: ['Ptr', 'bigint', 'string'], result: 'Ptr' },
  FPDF_LoadPage: { params: ['Ptr', 'number'], result: 'Ptr' },
  FPDF_LoadXFA: { params: ['Ptr'], result: 'boolean' },
  FPDF_MovePages: { params: ['Ptr', 'Ptr', 'number', 'number'], result: 'boolean' },
  FPDF_NewFormObjectFromXObject: { params: ['Ptr'], result: 'Ptr' },
  FPDF_NewXObjectFromPage: { params: ['Ptr', 'Ptr', 'number'], result: 'Ptr' },
  FPDF_PageToDevice: {
    params: [
      'Ptr',
      'number',
      'number',
      'number',
      'number',
      'number',
      'number',
      'number',
      'Ptr',
      'Ptr',
    ],
    result: 'boolean',
  },
  FPDF_RemoveFormFieldHighlight: { params: ['Ptr'], result: null },
  FPDF_RenderPage_Close: { params: ['Ptr'], result: null },
  FPDF_RenderPage_Continue: { params: ['Ptr', 'Ptr'], result: 'number' },
  FPDF_RenderPageBitmap: {
    params: ['Ptr', 'Ptr', 'number', 'number', 'number', 'number', 'number', 'number'],
    result: null,
  },
  FPDF_RenderPageBitmap_Start: {
    params: ['Ptr', 'Ptr', 'number', 'number', 'number', 'number', 'number', 'number', 'Ptr'],
    result: 'number',
  },
  FPDF_RenderPageBitmapWithColorScheme_Start: {
    params: [
      'Ptr',
      'Ptr',
      'number',
      'number',
      'number',
      'number',
      'number',
      'number',
      'Ptr',
      'Ptr',
    ],
    result: 'number',
  },
  FPDF_RenderPageBitmapWithMatrix: { params: ['Ptr', 'Ptr', 'Ptr', 'Ptr', 'number'], result: null },
  FPDF_SaveAsCopy: { params: ['Ptr', 'Ptr', 'Ptr'], result: 'boolean' },
  FPDF_SaveWithVersion: { params: ['Ptr', 'Ptr', 'Ptr', 'number'], result: 'boolean' },
  FPDF_SetFormFieldHighlightAlpha: { params: ['Ptr', 'number'], result: null },
  FPDF_SetFormFieldHighlightColor: { params: ['Ptr', 'number', 'number'], result: null },
  FPDF_SetSandBoxPolicy: { params: ['Ptr', 'boolean'], result: null },
  FPDF_SetSystemFontInfo: { params: ['Ptr'], result: null },
  FPDF_StructElement_Attr_CountChildren: { params: ['Ptr'], result: 'number' },
  FPDF_StructElement_Attr_GetBlobValue: {
    params: ['Ptr', 'Ptr', 'number', 'Ptr'],
    result: 'boolean',
  },
  FPDF_StructElement_Attr_GetBooleanValue: { params: ['Ptr', 'boolean'], result: 'boolean' },
  FPDF_StructElement_Attr_GetChildAtIndex: { params: ['Ptr', 'number'], result: 'Ptr' },
  FPDF_StructElement_Attr_GetCount: { params: ['Ptr'], result: 'number' },
  FPDF_StructElement_Attr_GetName: {
    params: ['Ptr', 'number', 'Ptr', 'number', 'Ptr'],
    result: 'boolean',
  },
  FPDF_StructElement_Attr_GetNumberValue: { params: ['Ptr', 'number'], result: 'boolean' },
  FPDF_StructElement_Attr_GetStringValue: {
    params: ['Ptr', 'Ptr', 'number', 'Ptr'],
    result: 'boolean',
  },
  FPDF_StructElement_Attr_GetType: { params: ['Ptr'], result: 'Ptr' },
  FPDF_StructElement_Attr_GetValue: { params: ['Ptr', 'string'], result: 'Ptr' },
  FPDF_StructElement_CountChildren: { params: ['Ptr'], result: 'number' },
  FPDF_StructElement_GetActualText: { params: ['Ptr', 'Ptr', 'number'], result: 'number' },
  FPDF_StructElement_GetAltText: { params: ['Ptr', 'Ptr', 'number'], result: 'number' },
  FPDF_StructElement_GetAttributeAtIndex: { params: ['Ptr', 'number'], result: 'Ptr' },
  FPDF_StructElement_GetAttributeCount: { params: ['Ptr'], result: 'number' },
  FPDF_StructElement_GetChildAtIndex: { params: ['Ptr', 'number'], result: 'Ptr' },
  FPDF_StructElement_GetChildMarkedContentID: { params: ['Ptr', 'number'], result: 'number' },
  FPDF_StructElement_GetID: { params: ['Ptr', 'Ptr', 'number'], result: 'number' },
  FPDF_StructElement_GetLang: { params: ['Ptr', 'Ptr', 'number'], result: 'number' },
  FPDF_StructElement_GetMarkedContentID: { params: ['Ptr'], result: 'number' },
  FPDF_StructElement_GetMarkedContentIdAtIndex: { params: ['Ptr', 'number'], result: 'number' },
  FPDF_StructElement_GetMarkedContentIdCount: { params: ['Ptr'], result: 'number' },
  FPDF_StructElement_GetObjType: { params: ['Ptr', 'Ptr', 'number'], result: 'number' },
  FPDF_StructElement_GetParent: { params: ['Ptr'], result: 'Ptr' },
  FPDF_StructElement_GetStringAttribute: {
    params: ['Ptr', 'string', 'Ptr', 'number'],
    result: 'number',
  },
  FPDF_StructElement_GetTitle: { params: ['Ptr', 'Ptr', 'number'], result: 'number' },
  FPDF_StructElement_GetType: { params: ['Ptr', 'Ptr', 'number'], result: 'number' },
  FPDF_StructTree_Close: { params: ['Ptr'], result: null },
  FPDF_StructTree_CountChildren: { params: ['Ptr'], result: 'number' },
  FPDF_StructTree_GetChildAtIndex: { params: ['Ptr', 'number'], result: 'Ptr' },
  FPDF_StructTree_GetForPage: { params: ['Ptr'], result: 'Ptr' },
  FPDF_VIEWERREF_GetDuplex: { params: ['Ptr'], result: 'Ptr' },
  FPDF_VIEWERREF_GetName: { params: ['Ptr', 'string', 'Ptr', 'number'], result: 'number' },
  FPDF_VIEWERREF_GetNumCopies: { params: ['Ptr'], result: 'number' },
  FPDF_VIEWERREF_GetPrintPageRange: { params: ['Ptr'], result: 'Ptr' },
  FPDF_VIEWERREF_GetPrintPageRangeCount: { params: ['Ptr'], result: 'bigint' },
  FPDF_VIEWERREF_GetPrintPageRangeElement: { params: ['Ptr', 'bigint'], result: 'number' },
  FPDF_VIEWERREF_GetPrintScaling: { params: ['Ptr'], result: 'boolean' },
  FPDFAction_GetDest: { params: ['Ptr', 'Ptr'], result: 'Ptr' },
  FPDFAction_GetFilePath: { params: ['Ptr', 'Ptr', 'number'], result: 'number' },
  FPDFAction_GetType: { params: ['Ptr'], result: 'number' },
  FPDFAction_GetURIPath: { params: ['Ptr', 'Ptr', 'Ptr', 'number'], result: 'number' },
  FPDFAnnot_AddFileAttachment: { params: ['Ptr', 'Ptr'], result: 'Ptr' },
  FPDFAnnot_AddInkStroke: { params: ['Ptr', 'Ptr', 'bigint'], result: 'number' },
  FPDFAnnot_AppendAttachmentPoints: { params: ['Ptr', 'Ptr'], result: 'boolean' },
  FPDFAnnot_AppendObject: { params: ['Ptr', 'Ptr'], result: 'boolean' },
  FPDFAnnot_CountAttachmentPoints: { params: ['Ptr'], result: 'bigint' },
  FPDFAnnot_GetAP: { params: ['Ptr', 'Ptr', 'Ptr', 'number'], result: 'number' },
  FPDFAnnot_GetAttachmentPoints: { params: ['Ptr', 'bigint', 'Ptr'], result: 'boolean' },
  FPDFAnnot_GetBorder: { params: ['Ptr', 'number', 'number', 'number'], result: 'boolean' },
  FPDFAnnot_GetColor: { params: ['Ptr', 'number', 'Ptr', 'Ptr', 'Ptr', 'Ptr'], result: 'boolean' },
  FPDFAnnot_GetFileAttachment: { params: ['Ptr'], result: 'Ptr' },
  FPDFAnnot_GetFlags: { params: ['Ptr'], result: 'number' },
  FPDFAnnot_GetFocusableSubtypes: { params: ['Ptr', 'Ptr', 'bigint'], result: 'boolean' },
  FPDFAnnot_GetFocusableSubtypesCount: { params: ['Ptr'], result: 'number' },
  FPDFAnnot_GetFontColor: { params: ['Ptr', 'Ptr', 'Ptr', 'Ptr', 'Ptr'], result: 'boolean' },
  FPDFAnnot_GetFontSize: { params: ['Ptr', 'Ptr', 'number'], result: 'boolean' },
  FPDFAnnot_GetFormAdditionalActionJavaScript: {
    params: ['Ptr', 'Ptr', 'number', 'Ptr', 'number'],
    result: 'number',
  },
  FPDFAnnot_GetFormControlCount: { params: ['Ptr', 'Ptr'], result: 'number' },
  FPDFAnnot_GetFormControlIndex: { params: ['Ptr', 'Ptr'], result: 'number' },
  FPDFAnnot_GetFormFieldAlternateName: {
    params: ['Ptr', 'Ptr', 'Ptr', 'number'],
    result: 'number',
  },
  FPDFAnnot_GetFormFieldAtPoint: { params: ['Ptr', 'Ptr', 'Ptr'], result: 'Ptr' },
  FPDFAnnot_GetFormFieldExportValue: { params: ['Ptr', 'Ptr', 'Ptr', 'number'], result: 'number' },
  FPDFAnnot_GetFormFieldFlags: { params: ['Ptr', 'Ptr'], result: 'number' },
  FPDFAnnot_GetFormFieldName: { params: ['Ptr', 'Ptr', 'Ptr', 'number'], result: 'number' },
  FPDFAnnot_GetFormFieldType: { params: ['Ptr', 'Ptr'], result: 'number' },
  FPDFAnnot_GetFormFieldValue: { params: ['Ptr', 'Ptr', 'Ptr', 'number'], result: 'number' },
  FPDFAnnot_GetInkListCount: { params: ['Ptr'], result: 'number' },
  FPDFAnnot_GetInkListPath: { params: ['Ptr', 'number', 'Ptr', 'number'], result: 'number' },
  FPDFAnnot_GetLine: { params: ['Ptr', 'Ptr', 'Ptr'], result: 'boolean' },
  FPDFAnnot_GetLink: { params: ['Ptr'], result: 'Ptr' },
  FPDFAnnot_GetLinkedAnnot: { params: ['Ptr', 'string'], result: 'Ptr' },
  FPDFAnnot_GetNumberValue: { params: ['Ptr', 'string', 'number'], result: 'boolean' },
  FPDFAnnot_GetObject: { params: ['Ptr', 'number'], result: 'Ptr' },
  FPDFAnnot_GetObjectCount: { params: ['Ptr'], result: 'number' },
  FPDFAnnot_GetOptionCount: { params: ['Ptr', 'Ptr'], result: 'number' },
  FPDFAnnot_GetOptionLabel: { params: ['Ptr', 'Ptr', 'number', 'Ptr', 'number'], result: 'number' },
  FPDFAnnot_GetRect: { params: ['Ptr', 'Ptr'], result: 'boolean' },
  FPDFAnnot_GetStringValue: { params: ['Ptr', 'string', 'Ptr', 'number'], result: 'number' },
  FPDFAnnot_GetSubtype: { params: ['Ptr'], result: 'Ptr' },
  FPDFAnnot_GetValueType: { params: ['Ptr', 'string'], result: 'Ptr' },
  FPDFAnnot_GetVertices: { params: ['Ptr', 'Ptr', 'number'], result: 'number' },
  FPDFAnnot_HasAttachmentPoints: { params: ['Ptr'], result: 'boolean' },
  FPDFAnnot_HasKey: { params: ['Ptr', 'string'], result: 'boolean' },
  FPDFAnnot_IsChecked: { params: ['Ptr', 'Ptr'], result: 'boolean' },
  FPDFAnnot_IsObjectSupportedSubtype: { params: ['Ptr'], result: 'boolean' },
  FPDFAnnot_IsOptionSelected: { params: ['Ptr', 'Ptr', 'number'], result: 'boolean' },
  FPDFAnnot_IsSupportedSubtype: { params: ['Ptr'], result: 'boolean' },
  FPDFAnnot_RemoveInkList: { params: ['Ptr'], result: 'boolean' },
  FPDFAnnot_RemoveObject: { params: ['Ptr', 'number'], result: 'boolean' },
  FPDFAnnot_SetAP: { params: ['Ptr', 'Ptr', 'Ptr'], result: 'boolean' },
  FPDFAnnot_SetAttachmentPoints: { params: ['Ptr', 'bigint', 'Ptr'], result: 'boolean' },
  FPDFAnnot_SetBorder: { params: ['Ptr', 'number', 'number', 'number'], result: 'boolean' },
  FPDFAnnot_SetColor: {
    params: ['Ptr', 'number', 'number', 'number', 'number', 'number'],
    result: 'boolean',
  },
  FPDFAnnot_SetFlags: { params: ['Ptr', 'number'], result: 'boolean' },
  FPDFAnnot_SetFocusableSubtypes: { params: ['Ptr', 'Ptr', 'bigint'], result: 'boolean' },
  FPDFAnnot_SetFontColor: {
    params: ['Ptr', 'Ptr', 'number', 'number', 'number'],
    result: 'boolean',
  },
  FPDFAnnot_SetFormFieldFlags: { params: ['Ptr', 'Ptr', 'number'], result: 'boolean' },
  FPDFAnnot_SetRect: { params: ['Ptr', 'Ptr'], result: 'boolean' },
  FPDFAnnot_SetStringValue: { params: ['Ptr', 'string', 'Ptr'], result: 'boolean' },
  FPDFAnnot_SetURI: { params: ['Ptr', 'Ptr'], result: 'boolean' },
  FPDFAnnot_UpdateObject: { params: ['Ptr', 'Ptr'], result: 'boolean' },
  FPDFAttachment_GetFile: { params: ['Ptr', 'Ptr', 'number', 'Ptr'], result: 'boolean' },
  FPDFAttachment_GetName: { params: ['Ptr', 'Ptr', 'number'], result: 'number' },
  FPDFAttachment_GetStringValue: { params: ['Ptr', 'string', 'Ptr', 'number'], result: 'number' },
  FPDFAttachment_GetSubtype: { params: ['Ptr', 'Ptr', 'number'], result: 'number' },
  FPDFAttachment_GetValueType: { params: ['Ptr', 'string'], result: 'Ptr' },
  FPDFAttachment_HasKey: { params: ['Ptr', 'string'], result: 'boolean' },
  FPDFAttachment_SetFile: { params: ['Ptr', 'Ptr', 'Ptr', 'number'], result: 'boolean' },
  FPDFAttachment_SetStringValue: { params: ['Ptr', 'string', 'Ptr'], result: 'boolean' },
  FPDFAvail_Create: { params: ['Ptr', 'Ptr'], result: 'Ptr' },
  FPDFAvail_Destroy: { params: ['Ptr'], result: null },
  FPDFAvail_GetDocument: { params: ['Ptr', 'string'], result: 'Ptr' },
  FPDFAvail_GetFirstPageNum: { params: ['Ptr'], result: 'number' },
  FPDFAvail_IsDocAvail: { params: ['Ptr', 'Ptr'], result: 'number' },
  FPDFAvail_IsFormAvail: { params: ['Ptr', 'Ptr'], result: 'number' },
  FPDFAvail_IsLinearized: { params: ['Ptr'], result: 'number' },
  FPDFAvail_IsPageAvail: { params: ['Ptr', 'number', 'Ptr'], result: 'number' },
  FPDFBitmap_Create: { params: ['number', 'number', 'number'], result: 'Ptr' },
  FPDFBitmap_CreateEx: { params: ['number', 'number', 'number', 'Ptr', 'number'], result: 'Ptr' },
  FPDFBitmap_Destroy: { params: ['Ptr'], result: null },
  FPDFBitmap_FillRect: {
    params: ['Ptr', 'number', 'number', 'number', 'number', 'Ptr'],
    result: 'boolean',
  },
  FPDFBitmap_GetBuffer: { params: ['Ptr'], result: 'Ptr' },
  FPDFBitmap_GetFormat: { params: ['Ptr'], result: 'number' },
  FPDFBitmap_GetHeight: { params: ['Ptr'], result: 'number' },
  FPDFBitmap_GetStride: { params: ['Ptr'], result: 'number' },
  FPDFBitmap_GetWidth: { params: ['Ptr'], result: 'number' },
  FPDFBookmark_Find: { params: ['Ptr', 'Ptr'], result: 'Ptr' },
  FPDFBookmark_GetAction: { params: ['Ptr'], result: 'Ptr' },
  FPDFBookmark_GetCount: { params: ['Ptr'], result: 'number' },
  FPDFBookmark_GetDest: { params: ['Ptr', 'Ptr'], result: 'Ptr' },
  FPDFBookmark_GetFirstChild: { params: ['Ptr', 'Ptr'], result: 'Ptr' },
  FPDFBookmark_GetNextSibling: { params: ['Ptr', 'Ptr'], result: 'Ptr' },
  FPDFBookmark_GetTitle: { params: ['Ptr', 'Ptr', 'number'], result: 'number' },
  FPDFCatalog_GetLanguage: { params: ['Ptr', 'Ptr', 'number'], result: 'number' },
  FPDFCatalog_IsTagged: { params: ['Ptr'], result: 'boolean' },
  FPDFCatalog_SetLanguage: { params: ['Ptr', 'Ptr'], result: 'boolean' },
  FPDFClipPath_CountPaths: { params: ['Ptr'], result: 'number' },
  FPDFClipPath_CountPathSegments: { params: ['Ptr', 'number'], result: 'number' },
  FPDFClipPath_GetPathSegment: { params: ['Ptr', 'number', 'number'], result: 'Ptr' },
  FPDFDest_GetDestPageIndex: { params: ['Ptr', 'Ptr'], result: 'number' },
  FPDFDest_GetLocationInPage: {
    params: ['Ptr', 'boolean', 'boolean', 'boolean', 'Ptr', 'Ptr', 'Ptr'],
    result: 'boolean',
  },
  FPDFDest_GetView: { params: ['Ptr', 'Ptr', 'Ptr'], result: 'number' },
  FPDFDoc_AddAttachment: { params: ['Ptr', 'Ptr'], result: 'Ptr' },
  FPDFDoc_CloseJavaScriptAction: { params: ['Ptr'], result: null },
  FPDFDoc_DeleteAttachment: { params: ['Ptr', 'number'], result: 'boolean' },
  FPDFDOC_ExitFormFillEnvironment: { params: ['Ptr'], result: null },
  FPDFDoc_GetAttachment: { params: ['Ptr', 'number'], result: 'Ptr' },
  FPDFDoc_GetAttachmentCount: { params: ['Ptr'], result: 'number' },
  FPDFDoc_GetJavaScriptAction: { params: ['Ptr', 'number'], result: 'Ptr' },
  FPDFDoc_GetJavaScriptActionCount: { params: ['Ptr'], result: 'number' },
  FPDFDoc_GetPageMode: { params: ['Ptr'], result: 'number' },
  FPDFDOC_InitFormFillEnvironment: { params: ['Ptr', 'Ptr'], result: 'Ptr' },
  FPDFFont_Close: { params: ['Ptr'], result: null },
  FPDFFont_GetAscent: { params: ['Ptr', 'number', 'number'], result: 'boolean' },
  FPDFFont_GetBaseFontName: { params: ['Ptr', 'Ptr', 'bigint'], result: 'bigint' },
  FPDFFont_GetDescent: { params: ['Ptr', 'number', 'number'], result: 'boolean' },
  FPDFFont_GetFamilyName: { params: ['Ptr', 'Ptr', 'bigint'], result: 'bigint' },
  FPDFFont_GetFlags: { params: ['Ptr'], result: 'number' },
  FPDFFont_GetFontData: { params: ['Ptr', 'Ptr', 'bigint', 'bigint'], result: 'boolean' },
  FPDFFont_GetGlyphPath: { params: ['Ptr', 'number', 'number'], result: 'Ptr' },
  FPDFFont_GetGlyphWidth: { params: ['Ptr', 'number', 'number', 'number'], result: 'boolean' },
  FPDFFont_GetIsEmbedded: { params: ['Ptr'], result: 'number' },
  FPDFFont_GetItalicAngle: { params: ['Ptr', 'Ptr'], result: 'boolean' },
  FPDFFont_GetWeight: { params: ['Ptr'], result: 'number' },
  FPDFFormObj_CountObjects: { params: ['Ptr'], result: 'number' },
  FPDFFormObj_GetObject: { params: ['Ptr', 'number'], result: 'Ptr' },
  FPDFFormObj_RemoveObject: { params: ['Ptr', 'Ptr'], result: 'boolean' },
  FPDFGlyphPath_CountGlyphSegments: { params: ['Ptr'], result: 'number' },
  FPDFGlyphPath_GetGlyphPathSegment: { params: ['Ptr', 'number'], result: 'Ptr' },
  FPDFImageObj_GetBitmap: { params: ['Ptr'], result: 'Ptr' },
  FPDFImageObj_GetIccProfileDataDecoded: {
    params: ['Ptr', 'Ptr', 'Ptr', 'bigint', 'bigint'],
    result: 'boolean',
  },
  FPDFImageObj_GetImageDataDecoded: { params: ['Ptr', 'Ptr', 'number'], result: 'number' },
  FPDFImageObj_GetImageDataRaw: { params: ['Ptr', 'Ptr', 'number'], result: 'number' },
  FPDFImageObj_GetImageFilter: { params: ['Ptr', 'number', 'Ptr', 'number'], result: 'number' },
  FPDFImageObj_GetImageFilterCount: { params: ['Ptr'], result: 'number' },
  FPDFImageObj_GetImageMetadata: { params: ['Ptr', 'Ptr', 'Ptr'], result: 'boolean' },
  FPDFImageObj_GetImagePixelSize: { params: ['Ptr', 'Ptr', 'Ptr'], result: 'boolean' },
  FPDFImageObj_GetRenderedBitmap: { params: ['Ptr', 'Ptr', 'Ptr'], result: 'Ptr' },
  FPDFImageObj_LoadJpegFile: { params: ['Ptr', 'number', 'Ptr', 'Ptr'], result: 'boolean' },
  FPDFImageObj_LoadJpegFileInline: { params: ['Ptr', 'number', 'Ptr', 'Ptr'], result: 'boolean' },
  FPDFImageObj_SetBitmap: { params: ['Ptr', 'number', 'Ptr', 'Ptr'], result: 'boolean' },
  FPDFImageObj_SetMatrix: {
    params: ['Ptr', 'number', 'number', 'number', 'number', 'number', 'number'],
    result: 'boolean',
  },
  FPDFJavaScriptAction_GetName: { params: ['Ptr', 'Ptr', 'number'], result: 'number' },
  FPDFJavaScriptAction_GetScript: { params: ['Ptr', 'Ptr', 'number'], result: 'number' },
  FPDFLink_CloseWebLinks: { params: ['Ptr'], result: null },
  FPDFLink_CountQuadPoints: { params: ['Ptr'], result: 'number' },
  FPDFLink_CountRects: { params: ['Ptr', 'number'], result: 'number' },
  FPDFLink_CountWebLinks: { params: ['Ptr'], result: 'number' },
  FPDFLink_Enumerate: { params: ['Ptr', 'Ptr', 'Ptr'], result: 'boolean' },
  FPDFLink_GetAction: { params: ['Ptr'], result: 'Ptr' },
  FPDFLink_GetAnnot: { params: ['Ptr', 'Ptr'], result: 'Ptr' },
  FPDFLink_GetAnnotRect: { params: ['Ptr', 'Ptr'], result: 'boolean' },
  FPDFLink_GetDest: { params: ['Ptr', 'Ptr'], result: 'Ptr' },
  FPDFLink_GetLinkAtPoint: { params: ['Ptr', 'number', 'number'], result: 'Ptr' },
  FPDFLink_GetLinkZOrderAtPoint: { params: ['Ptr', 'number', 'number'], result: 'number' },
  FPDFLink_GetQuadPoints: { params: ['Ptr', 'number', 'Ptr'], result: 'boolean' },
  FPDFLink_GetRect: {
    params: ['Ptr', 'number', 'number', 'number', 'number', 'number', 'number'],
    result: 'boolean',
  },
  FPDFLink_GetTextRange: { params: ['Ptr', 'number', 'Ptr', 'Ptr'], result: 'boolean' },
  FPDFLink_GetURL: { params: ['Ptr', 'number', 'Ptr', 'number'], result: 'number' },
  FPDFLink_LoadWebLinks: { params: ['Ptr'], result: 'Ptr' },
  FPDFPage_CloseAnnot: { params: ['Ptr'], result: null },
  FPDFPage_CountObjects: { params: ['Ptr'], result: 'number' },
  FPDFPage_CreateAnnot: { params: ['Ptr', 'Ptr'], result: 'Ptr' },
  FPDFPage_Delete: { params: ['Ptr', 'number'], result: null },
  FPDFPage_Flatten: { params: ['Ptr', 'number'], result: 'number' },
  FPDFPage_FormFieldZOrderAtPoint: { params: ['Ptr', 'Ptr', 'number', 'number'], result: 'number' },
  FPDFPage_GenerateContent: { params: ['Ptr'], result: 'boolean' },
  FPDFPage_GetAnnot: { params: ['Ptr', 'number'], result: 'Ptr' },
  FPDFPage_GetAnnotCount: { params: ['Ptr'], result: 'number' },
  FPDFPage_GetAnnotIndex: { params: ['Ptr', 'Ptr'], result: 'number' },
  FPDFPage_GetArtBox: {
    params: ['Ptr', 'number', 'number', 'number', 'number'],
    result: 'boolean',
  },
  FPDFPage_GetBleedBox: {
    params: ['Ptr', 'number', 'number', 'number', 'number'],
    result: 'boolean',
  },
  FPDFPage_GetCropBox: {
    params: ['Ptr', 'number', 'number', 'number', 'number'],
    result: 'boolean',
  },
  FPDFPage_GetDecodedThumbnailData: { params: ['Ptr', 'Ptr', 'number'], result: 'number' },
  FPDFPage_GetMediaBox: {
    params: ['Ptr', 'number', 'number', 'number', 'number'],
    result: 'boolean',
  },
  FPDFPage_GetObject: { params: ['Ptr', 'number'], result: 'Ptr' },
  FPDFPage_GetRawThumbnailData: { params: ['Ptr', 'Ptr', 'number'], result: 'number' },
  FPDFPage_GetRotation: { params: ['Ptr'], result: 'number' },
  FPDFPage_GetThumbnailAsBitmap: { params: ['Ptr'], result: 'Ptr' },
  FPDFPage_GetTrimBox: {
    params: ['Ptr', 'number', 'number', 'number', 'number'],
    result: 'boolean',
  },
  FPDFPage_HasFormFieldAtPoint: { params: ['Ptr', 'Ptr', 'number', 'number'], result: 'number' },
  FPDFPage_HasTransparency: { params: ['Ptr'], result: 'boolean' },
  FPDFPage_InsertClipPath: { params: ['Ptr', 'Ptr'], result: null },
  FPDFPage_InsertObject: { params: ['Ptr', 'Ptr'], result: null },
  FPDFPage_InsertObjectAtIndex: { params: ['Ptr', 'Ptr', 'bigint'], result: 'boolean' },
  FPDFPage_New: { params: ['Ptr', 'number', 'number', 'number'], result: 'Ptr' },
  FPDFPage_RemoveAnnot: { params: ['Ptr', 'number'], result: 'boolean' },
  FPDFPage_RemoveObject: { params: ['Ptr', 'Ptr'], result: 'boolean' },
  FPDFPage_SetArtBox: { params: ['Ptr', 'number', 'number', 'number', 'number'], result: null },
  FPDFPage_SetBleedBox: { params: ['Ptr', 'number', 'number', 'number', 'number'], result: null },
  FPDFPage_SetCropBox: { params: ['Ptr', 'number', 'number', 'number', 'number'], result: null },
  FPDFPage_SetMediaBox: { params: ['Ptr', 'number', 'number', 'number', 'number'], result: null },
  FPDFPage_SetRotation: { params: ['Ptr', 'number'], result: null },
  FPDFPage_SetTrimBox: { params: ['Ptr', 'number', 'number', 'number', 'number'], result: null },
  FPDFPage_TransformAnnots: {
    params: ['Ptr', 'number', 'number', 'number', 'number', 'number', 'number'],
    result: null,
  },
  FPDFPage_TransFormWithClip: { params: ['Ptr', 'Ptr', 'Ptr'], result: 'boolean' },
  FPDFPageObj_AddMark: { params: ['Ptr', 'string'], result: 'Ptr' },
  FPDFPageObj_CountMarks: { params: ['Ptr'], result: 'number' },
  FPDFPageObj_CreateNewPath: { params: ['number', 'number'], result: 'Ptr' },
  FPDFPageObj_CreateNewRect: { params: ['number', 'number', 'number', 'number'], result: 'Ptr' },
  FPDFPageObj_CreateTextObj: { params: ['Ptr', 'Ptr', 'number'], result: 'Ptr' },
  FPDFPageObj_Destroy: { params: ['Ptr'], result: null },
  FPDFPageObj_GetBounds: {
    params: ['Ptr', 'number', 'number', 'number', 'number'],
    result: 'boolean',
  },
  FPDFPageObj_GetClipPath: { params: ['Ptr'], result: 'Ptr' },
  FPDFPageObj_GetDashArray: { params: ['Ptr', 'number', 'bigint'], result: 'boolean' },
  FPDFPageObj_GetDashCount: { params: ['Ptr'], result: 'number' },
  FPDFPageObj_GetDashPhase: { params: ['Ptr', 'number'], result: 'boolean' },
  FPDFPageObj_GetFillColor: { params: ['Ptr', 'Ptr', 'Ptr', 'Ptr', 'Ptr'], result: 'boolean' },
  FPDFPageObj_GetIsActive: { params: ['Ptr', 'boolean'], result: 'boolean' },
  FPDFPageObj_GetLineCap: { params: ['Ptr'], result: 'number' },
  FPDFPageObj_GetLineJoin: { params: ['Ptr'], result: 'number' },
  FPDFPageObj_GetMark: { params: ['Ptr', 'number'], result: 'Ptr' },
  FPDFPageObj_GetMarkedContentID: { params: ['Ptr'], result: 'number' },
  FPDFPageObj_GetMatrix: { params: ['Ptr', 'Ptr'], result: 'boolean' },
  FPDFPageObj_GetRotatedBounds: { params: ['Ptr', 'Ptr'], result: 'boolean' },
  FPDFPageObj_GetStrokeColor: { params: ['Ptr', 'Ptr', 'Ptr', 'Ptr', 'Ptr'], result: 'boolean' },
  FPDFPageObj_GetStrokeWidth: { params: ['Ptr', 'number'], result: 'boolean' },
  FPDFPageObj_GetType: { params: ['Ptr'], result: 'number' },
  FPDFPageObj_HasTransparency: { params: ['Ptr'], result: 'boolean' },
  FPDFPageObj_NewImageObj: { params: ['Ptr'], result: 'Ptr' },
  FPDFPageObj_NewTextObj: { params: ['Ptr', 'string', 'number'], result: 'Ptr' },
  FPDFPageObj_RemoveMark: { params: ['Ptr', 'Ptr'], result: 'boolean' },
  FPDFPageObj_SetBlendMode: { params: ['Ptr', 'string'], result: null },
  FPDFPageObj_SetDashArray: { params: ['Ptr', 'number', 'bigint', 'number'], result: 'boolean' },
  FPDFPageObj_SetDashPhase: { params: ['Ptr', 'number'], result: 'boolean' },
  FPDFPageObj_SetFillColor: {
    params: ['Ptr', 'number', 'number', 'number', 'number'],
    result: 'boolean',
  },
  FPDFPageObj_SetIsActive: { params: ['Ptr', 'boolean'], result: 'boolean' },
  FPDFPageObj_SetLineCap: { params: ['Ptr', 'number'], result: 'boolean' },
  FPDFPageObj_SetLineJoin: { params: ['Ptr', 'number'], result: 'boolean' },
  FPDFPageObj_SetMatrix: { params: ['Ptr', 'Ptr'], result: 'boolean' },
  FPDFPageObj_SetStrokeColor: {
    params: ['Ptr', 'number', 'number', 'number', 'number'],
    result: 'boolean',
  },
  FPDFPageObj_SetStrokeWidth: { params: ['Ptr', 'number'], result: 'boolean' },
  FPDFPageObj_Transform: {
    params: ['Ptr', 'number', 'number', 'number', 'number', 'number', 'number'],
    result: null,
  },
  FPDFPageObj_TransformClipPath: {
    params: ['Ptr', 'number', 'number', 'number', 'number', 'number', 'number'],
    result: null,
  },
  FPDFPageObj_TransformF: { params: ['Ptr', 'Ptr'], result: 'boolean' },
  FPDFPageObjMark_CountParams: { params: ['Ptr'], result: 'number' },
  FPDFPageObjMark_GetName: { params: ['Ptr', 'Ptr', 'number', 'Ptr'], result: 'boolean' },
  FPDFPageObjMark_GetParamBlobValue: {
    params: ['Ptr', 'string', 'Ptr', 'number', 'Ptr'],
    result: 'boolean',
  },
  FPDFPageObjMark_GetParamFloatValue: { params: ['Ptr', 'string', 'number'], result: 'boolean' },
  FPDFPageObjMark_GetParamIntValue: { params: ['Ptr', 'string', 'Ptr'], result: 'boolean' },
  FPDFPageObjMark_GetParamKey: {
    params: ['Ptr', 'number', 'Ptr', 'number', 'Ptr'],
    result: 'boolean',
  },
  FPDFPageObjMark_GetParamStringValue: {
    params: ['Ptr', 'string', 'Ptr', 'number', 'Ptr'],
    result: 'boolean',
  },
  FPDFPageObjMark_GetParamValueType: { params: ['Ptr', 'string'], result: 'Ptr' },
  FPDFPageObjMark_RemoveParam: { params: ['Ptr', 'Ptr', 'string'], result: 'boolean' },
  FPDFPageObjMark_SetBlobParam: {
    params: ['Ptr', 'Ptr', 'Ptr', 'string', 'Ptr', 'number'],
    result: 'boolean',
  },
  FPDFPageObjMark_SetFloatParam: {
    params: ['Ptr', 'Ptr', 'Ptr', 'string', 'number'],
    result: 'boolean',
  },
  FPDFPageObjMark_SetIntParam: {
    params: ['Ptr', 'Ptr', 'Ptr', 'string', 'number'],
    result: 'boolean',
  },
  FPDFPageObjMark_SetStringParam: {
    params: ['Ptr', 'Ptr', 'Ptr', 'string', 'string'],
    result: 'boolean',
  },
  FPDFPath_BezierTo: {
    params: ['Ptr', 'number', 'number', 'number', 'number', 'number', 'number'],
    result: 'boolean',
  },
  FPDFPath_Close: { params: ['Ptr'], result: 'boolean' },
  FPDFPath_CountSegments: { params: ['Ptr'], result: 'number' },
  FPDFPath_GetDrawMode: { params: ['Ptr', 'Ptr', 'boolean'], result: 'boolean' },
  FPDFPath_GetPathSegment: { params: ['Ptr', 'number'], result: 'Ptr' },
  FPDFPath_LineTo: { params: ['Ptr', 'number', 'number'], result: 'boolean' },
  FPDFPath_MoveTo: { params: ['Ptr', 'number', 'number'], result: 'boolean' },
  FPDFPath_SetDrawMode: { params: ['Ptr', 'number', 'boolean'], result: 'boolean' },
  FPDFPathSegment_GetClose: { params: ['Ptr'], result: 'boolean' },
  FPDFPathSegment_GetPoint: { params: ['Ptr', 'number', 'number'], result: 'boolean' },
  FPDFPathSegment_GetType: { params: ['Ptr'], result: 'number' },
  FPDFSignatureObj_GetByteRange: { params: ['Ptr', 'Ptr', 'number'], result: 'number' },
  FPDFSignatureObj_GetContents: { params: ['Ptr', 'Ptr', 'number'], result: 'number' },
  FPDFSignatureObj_GetDocMDPPermission: { params: ['Ptr'], result: 'number' },
  FPDFSignatureObj_GetReason: { params: ['Ptr', 'Ptr', 'number'], result: 'number' },
  FPDFSignatureObj_GetSubFilter: { params: ['Ptr', 'Ptr', 'number'], result: 'number' },
  FPDFSignatureObj_GetTime: { params: ['Ptr', 'Ptr', 'number'], result: 'number' },
  FPDFText_ClosePage: { params: ['Ptr'], result: null },
  FPDFText_CountChars: { params: ['Ptr'], result: 'number' },
  FPDFText_CountRects: { params: ['Ptr', 'number', 'number'], result: 'number' },
  FPDFText_FindClose: { params: ['Ptr'], result: null },
  FPDFText_FindNext: { params: ['Ptr'], result: 'boolean' },
  FPDFText_FindPrev: { params: ['Ptr'], result: 'boolean' },
  FPDFText_FindStart: { params: ['Ptr', 'Ptr', 'number', 'number'], result: 'Ptr' },
  FPDFText_GetBoundedText: {
    params: ['Ptr', 'number', 'number', 'number', 'number', 'Ptr', 'number'],
    result: 'number',
  },
  FPDFText_GetCharAngle: { params: ['Ptr', 'number'], result: 'number' },
  FPDFText_GetCharBox: {
    params: ['Ptr', 'number', 'number', 'number', 'number', 'number'],
    result: 'boolean',
  },
  FPDFText_GetCharIndexAtPos: {
    params: ['Ptr', 'number', 'number', 'number', 'number'],
    result: 'number',
  },
  FPDFText_GetCharIndexFromTextIndex: { params: ['Ptr', 'number'], result: 'number' },
  FPDFText_GetCharOrigin: { params: ['Ptr', 'number', 'number', 'number'], result: 'boolean' },
  FPDFText_GetFillColor: {
    params: ['Ptr', 'number', 'Ptr', 'Ptr', 'Ptr', 'Ptr'],
    result: 'boolean',
  },
  FPDFText_GetFontInfo: { params: ['Ptr', 'number', 'Ptr', 'number', 'Ptr'], result: 'number' },
  FPDFText_GetFontSize: { params: ['Ptr', 'number'], result: 'number' },
  FPDFText_GetFontWeight: { params: ['Ptr', 'number'], result: 'number' },
  FPDFText_GetLooseCharBox: { params: ['Ptr', 'number', 'Ptr'], result: 'boolean' },
  FPDFText_GetMatrix: { params: ['Ptr', 'number', 'Ptr'], result: 'boolean' },
  FPDFText_GetRect: {
    params: ['Ptr', 'number', 'number', 'number', 'number', 'number'],
    result: 'boolean',
  },
  FPDFText_GetSchCount: { params: ['Ptr'], result: 'number' },
  FPDFText_GetSchResultIndex: { params: ['Ptr'], result: 'number' },
  FPDFText_GetStrokeColor: {
    params: ['Ptr', 'number', 'Ptr', 'Ptr', 'Ptr', 'Ptr'],
    result: 'boolean',
  },
  FPDFText_GetText: { params: ['Ptr', 'number', 'number', 'Ptr'], result: 'number' },
  FPDFText_GetTextIndexFromCharIndex: { params: ['Ptr', 'number'], result: 'number' },
  FPDFText_GetTextObject: { params: ['Ptr', 'number'], result: 'Ptr' },
  FPDFText_GetUnicode: { params: ['Ptr', 'number'], result: 'number' },
  FPDFText_HasUnicodeMapError: { params: ['Ptr', 'number'], result: 'number' },
  FPDFText_IsGenerated: { params: ['Ptr', 'number'], result: 'number' },
  FPDFText_IsHyphen: { params: ['Ptr', 'number'], result: 'number' },
  FPDFText_LoadCidType2Font: {
    params: ['Ptr', 'Ptr', 'number', 'string', 'Ptr', 'number'],
    result: 'Ptr',
  },
  FPDFText_LoadFont: { params: ['Ptr', 'Ptr', 'number', 'number', 'boolean'], result: 'Ptr' },
  FPDFText_LoadPage: { params: ['Ptr'], result: 'Ptr' },
  FPDFText_LoadStandardFont: { params: ['Ptr', 'string'], result: 'Ptr' },
  FPDFText_SetCharcodes: { params: ['Ptr', 'Ptr', 'bigint'], result: 'boolean' },
  FPDFText_SetText: { params: ['Ptr', 'Ptr'], result: 'boolean' },
  FPDFTextObj_GetFont: { params: ['Ptr'], result: 'Ptr' },
  FPDFTextObj_GetFontSize: { params: ['Ptr', 'number'], result: 'boolean' },
  FPDFTextObj_GetRenderedBitmap: { params: ['Ptr', 'Ptr', 'Ptr', 'number'], result: 'Ptr' },
  FPDFTextObj_GetText: { params: ['Ptr', 'Ptr', 'Ptr', 'number'], result: 'number' },
  FPDFTextObj_GetTextRenderMode: { params: ['Ptr'], result: 'Ptr' },
  FPDFTextObj_SetTextRenderMode: { params: ['Ptr', 'Ptr'], result: 'boolean' },
} as const;

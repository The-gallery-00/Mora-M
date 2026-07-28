/**
 * 보관함 문서 데이터 레이어 (Phase 4) 배럴.
 *
 * 화면(`app/(tabs)/archive/*`, `app/document/*`)은 이 파일만 import 한다.
 * 계층 규약: 화면은 **훅과 앱 모델만** 쓴다. `request()`·`resolveImageUrl()`·서버 DTO 에
 * 직접 손대는 화면 코드는 리뷰 반려 대상이다.
 */

// ── 타입 ─────────────────────────────────────────────────────────────
export type {
  CardDetail,
  CardGroup,
  CardGroupDto,
  CardGroupFilter,
  CardDto,
  CardUpdateInput,
  DocumentDeleteInput,
  DocumentDetail,
  DocumentDetailFor,
  DocumentId,
  DocumentIdFor,
  DocumentListParams,
  DocumentPage,
  DocumentRouteSegment,
  DocumentSummary,
  DocumentType,
  DocumentUpdateInput,
  IntId,
  PageMeta,
  PosterDetail,
  PosterDto,
  PosterUpdateInput,
  ReceiptDetail,
  ReceiptDto,
  ReceiptItem,
  ReceiptItemDto,
  ReceiptUpdateInput,
  TicketDetail,
  TicketDto,
  TicketUpdateInput,
  Uuid,
} from './types';
export {
  DOC_ROUTE_SEGMENT,
  DOCUMENT_TYPES,
  DOCUMENT_TYPE_LABELS,
  documentTypeFromSegment,
  isDocumentType,
} from './types';

// ── 어댑터 (검색·홈 등 다른 기능도 재사용한다) ────────────────────────
export {
  SUMMARY_FALLBACK,
  parseJsonObject,
  toCardDetail,
  toCardGroup,
  toDocumentDetail,
  toDocumentSummaries,
  toDocumentSummary,
  toPosterDetail,
  toReceiptDetail,
  toReceiptItem,
  toTicketDetail,
} from './mappers';

// ── 네트워크 ─────────────────────────────────────────────────────────
export {
  DOCUMENT_PAGE_SIZE,
  DOCUMENT_WRITE_TIMEOUT_MS,
  buildUpdateBody,
  deleteDocument,
  fetchDocument,
  listDocuments,
  unwrapDocumentPage,
  updateDocument,
} from './api';

// ── React Query ──────────────────────────────────────────────────────
export type { DocumentOperation, UseInfiniteDocumentsOptions } from './queries';
export {
  DOCUMENT_COPY,
  DocumentError,
  documentKeys,
  toDocumentError,
  useDeleteDocument,
  useDocument,
  useInfiniteDocuments,
  useUpdateDocument,
} from './queries';

// ── 명함 그룹 ────────────────────────────────────────────────────────
export type { CardGroupOperation } from './groups';
export {
  CARD_GROUP_COPY,
  CARD_GROUP_FIXED_LABELS,
  CARD_GROUP_NAME_MAX,
  CardGroupError,
  cardGroupKeys,
  createCardGroup,
  deleteCardGroup,
  listCardGroups,
  moveCardToGroup,
  renameCardGroup,
  useCardGroups,
  useCreateCardGroup,
  useDeleteCardGroup,
  useMoveCardToGroup,
  useRenameCardGroup,
} from './groups';

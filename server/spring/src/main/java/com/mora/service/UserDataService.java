package com.mora.service;

import com.mora.dto.UserDataDeleteResponse;
import com.mora.repository.BusinessCardRepository;
import com.mora.repository.PosterRepository;
import com.mora.repository.ReceiptRepository;
import com.mora.repository.TicketRepository;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.UUID;

// API-62 내 데이터 전체 삭제. 계정은 남기고 문서 4종+검색기록+알림만 지움
@Service
public class UserDataService {

    private final BusinessCardRepository businessCardRepository;
    private final PosterRepository posterRepository;
    private final TicketRepository ticketRepository;
    private final ReceiptRepository receiptRepository;
    private final StoredImageService storedImageService;
    private final SearchHistoryService searchHistoryService;
    private final NotificationService notificationService;

    public UserDataService(BusinessCardRepository businessCardRepository, PosterRepository posterRepository,
                            TicketRepository ticketRepository, ReceiptRepository receiptRepository,
                            StoredImageService storedImageService, SearchHistoryService searchHistoryService,
                            NotificationService notificationService) {
        this.businessCardRepository = businessCardRepository;
        this.posterRepository = posterRepository;
        this.ticketRepository = ticketRepository;
        this.receiptRepository = receiptRepository;
        this.storedImageService = storedImageService;
        this.searchHistoryService = searchHistoryService;
        this.notificationService = notificationService;
    }

    @Transactional
    public UserDataDeleteResponse deleteAllDocuments(UUID userId) {
        // Failure rolls back registry/document changes, retaining retryable ownership.
        storedImageService.deleteAll(userId);

        long deletedBusinessCards = businessCardRepository.deleteByUserId(userId);
        long deletedTickets = ticketRepository.deleteByUserId(userId);
        long deletedPosters = posterRepository.deleteByUserId(userId);
        long deletedReceipts = receiptRepository.deleteByUserId(userId);
        long deletedSearchHistories = searchHistoryService.clear(userId);
        long deletedNotifications = notificationService.deleteAll(userId);

        return new UserDataDeleteResponse(
                deletedBusinessCards, deletedTickets, deletedPosters, deletedReceipts,
                deletedSearchHistories, 0L, deletedNotifications
        );
    }
}

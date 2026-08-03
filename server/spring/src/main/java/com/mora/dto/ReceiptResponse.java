package com.mora.dto;

import com.mora.entity.Receipt;
import lombok.Getter;
import lombok.Setter;

import java.math.BigDecimal;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.LocalTime;
import java.util.List;
import java.util.UUID;

@Getter
@Setter
public class ReceiptResponse {
    private Integer id;
    private UUID userId;
    private String docType;
    private BigDecimal classificationConfidence;
    private String merchantName;
    private String merchantAddress;
    private LocalDate purchaseDate;
    private LocalTime purchaseTime;
    private String paymentMethod;
    private String cardCompany;
    private BigDecimal totalAmount;
    private String currencyCode;
    private String rawText;
    private String parsedJson;
    private String rawJson;
    private List<ReceiptItemResponse> items;
    private LocalDateTime createdAt;
    private LocalDateTime updatedAt;
    private Double similarity;

    public static ReceiptResponse from(Receipt receipt) {
        ReceiptResponse response = new ReceiptResponse();
        response.setId(receipt.getId());
        response.setUserId(receipt.getUserId());
        response.setDocType(receipt.getDocType());
        response.setClassificationConfidence(receipt.getClassificationConfidence());
        response.setMerchantName(receipt.getMerchantName());
        response.setMerchantAddress(receipt.getMerchantAddress());
        response.setPurchaseDate(receipt.getPurchaseDate());
        response.setPurchaseTime(receipt.getPurchaseTime());
        response.setPaymentMethod(receipt.getPaymentMethod());
        response.setCardCompany(receipt.getCardCompany());
        response.setTotalAmount(receipt.getTotalAmount());
        response.setCurrencyCode(receipt.getCurrencyCode());
        response.setRawText(receipt.getRawText());
        response.setParsedJson(receipt.getParsedJson());
        response.setRawJson(receipt.getRawJson());
        response.setItems(receipt.getItems().stream().map(ReceiptItemResponse::from).toList());
        response.setCreatedAt(receipt.getCreatedAt());
        response.setUpdatedAt(receipt.getUpdatedAt());
        return response;
    }
}

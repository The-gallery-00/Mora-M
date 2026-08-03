package com.mora.dto;

import lombok.Getter;
import lombok.Setter;

import java.math.BigDecimal;
import java.util.List;

@Getter
@Setter
public class ReceiptSaveRequest {
    private String docType;
    private BigDecimal classificationConfidence;
    private String merchantName;
    private String merchantAddress;
    private String purchaseDate;
    private String purchaseTime;
    private String paymentMethod;
    private String cardCompany;
    private BigDecimal totalAmount;
    private String currencyCode;
    private List<String> rawText;
    private String parsedJson;
    private String rawJson;
    private List<ReceiptItemRequest> items;
}

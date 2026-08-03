package com.mora.dto;

import com.mora.entity.ReceiptItem;
import lombok.Getter;
import lombok.Setter;

import java.math.BigDecimal;
import java.time.LocalDateTime;

@Getter
@Setter
public class ReceiptItemResponse {
    private Integer id;
    private String itemName;
    private BigDecimal quantity;
    private BigDecimal unitPrice;
    private BigDecimal totalPrice;
    private String category;
    private LocalDateTime createdAt;

    public static ReceiptItemResponse from(ReceiptItem item) {
        ReceiptItemResponse response = new ReceiptItemResponse();
        response.setId(item.getId());
        response.setItemName(item.getItemName());
        response.setQuantity(item.getQuantity());
        response.setUnitPrice(item.getUnitPrice());
        response.setTotalPrice(item.getTotalPrice());
        response.setCategory(item.getCategory());
        response.setCreatedAt(item.getCreatedAt());
        return response;
    }
}

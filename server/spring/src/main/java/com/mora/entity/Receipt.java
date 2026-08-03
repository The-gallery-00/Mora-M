package com.mora.entity;

import jakarta.persistence.*;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;

import java.math.BigDecimal;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.LocalTime;
import java.util.ArrayList;
import java.util.List;
import java.util.Objects;
import java.util.UUID;

@Getter
@Setter
@NoArgsConstructor
@Entity
@Table(name = "receipts")
public class Receipt {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Integer id;

    @Column(name = "user_id", nullable = false)
    private UUID userId;

    @Column(name = "doc_type", nullable = false, length = 30)
    private String docType = "RECEIPT";

    @Column(name = "classification_confidence", precision = 4, scale = 3)
    private BigDecimal classificationConfidence;

    private String merchantName;

    @Column(columnDefinition = "TEXT")
    private String merchantAddress;

    private LocalDate purchaseDate;
    private LocalTime purchaseTime;
    private String paymentMethod;
    private String cardCompany;

    @Column(precision = 12, scale = 2)
    private BigDecimal totalAmount;

    private String currencyCode = "KRW";

    @Column(name = "raw_text", columnDefinition = "TEXT")
    private String rawText;

    @Column(name = "parsed_json", columnDefinition = "jsonb")
    @org.hibernate.annotations.ColumnTransformer(write = "?::jsonb")
    private String parsedJson;

    @Column(name = "raw_json", columnDefinition = "jsonb")
    @org.hibernate.annotations.ColumnTransformer(write = "?::jsonb")
    private String rawJson;

    @Column(columnDefinition = "vector(1536)")
    private String embedding;

    @OneToMany(mappedBy = "receipt", cascade = CascadeType.ALL, orphanRemoval = true)
    @OrderBy("id ASC")
    private List<ReceiptItem> items = new ArrayList<>();

    @Column(name = "created_at", updatable = false)
    private LocalDateTime createdAt;

    private LocalDateTime updatedAt;

    @PrePersist
    protected void onCreate() {
        this.createdAt = LocalDateTime.now();
        this.updatedAt = LocalDateTime.now();
    }

    @PreUpdate
    protected void onUpdate() {
        this.updatedAt = LocalDateTime.now();
    }

    public void replaceItems(List<ReceiptItem> newItems) {
        items.clear();
        if (newItems == null) return;
        for (ReceiptItem item : newItems) {
            addItem(item);
        }
    }

    public void addItem(ReceiptItem item) {
        item.setReceipt(this);
        items.add(item);
    }

    @Override
    public boolean equals(Object o) {
        if (this == o) return true;
        if (o == null || getClass() != o.getClass()) return false;
        Receipt receipt = (Receipt) o;
        return Objects.equals(id, receipt.id);
    }

    @Override
    public int hashCode() {
        return Objects.hash(id);
    }
}

package com.mora.dto;

import com.mora.entity.CardGroup;

import java.time.LocalDateTime;
import java.util.UUID;

public class CardGroupResponse {
    private UUID id;
    private String name;
    private LocalDateTime createdAt;

    public static CardGroupResponse from(CardGroup group) {
        CardGroupResponse response = new CardGroupResponse();
        response.setId(group.getId());
        response.setName(group.getName());
        response.setCreatedAt(group.getCreatedAt());
        return response;
    }

    public UUID getId() {
        return id;
    }

    public void setId(UUID id) {
        this.id = id;
    }

    public String getName() {
        return name;
    }

    public void setName(String name) {
        this.name = name;
    }

    public LocalDateTime getCreatedAt() {
        return createdAt;
    }

    public void setCreatedAt(LocalDateTime createdAt) {
        this.createdAt = createdAt;
    }
}

package com.mora.dto;

import java.util.UUID;

public class CardMoveGroupRequest {
    private UUID groupId;

    public UUID getGroupId() {
        return groupId;
    }

    public void setGroupId(UUID groupId) {
        this.groupId = groupId;
    }
}

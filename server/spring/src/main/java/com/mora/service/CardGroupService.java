package com.mora.service;

import com.mora.dto.CardGroupResponse;
import com.mora.entity.CardGroup;
import com.mora.repository.CardGroupRepository;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;
import java.util.UUID;

@Service
public class CardGroupService {

    private static final int MAX_GROUP_NAME_LENGTH = 60;

    private final CardGroupRepository groupRepository;

    public CardGroupService(CardGroupRepository groupRepository) {
        this.groupRepository = groupRepository;
    }

    public List<CardGroupResponse> list(UUID userId) {
        return groupRepository.findByUserIdOrderByCreatedAtAsc(userId)
                .stream()
                .map(CardGroupResponse::from)
                .toList();
    }

    public CardGroupResponse create(UUID userId, String rawName) {
        String name = normalizeName(rawName);
        ensureUnique(userId, name);

        CardGroup group = new CardGroup();
        group.setUserId(userId);
        group.setName(name);
        return CardGroupResponse.from(groupRepository.save(group));
    }

    public CardGroupResponse rename(UUID userId, UUID groupId, String rawName) {
        String name = normalizeName(rawName);
        CardGroup group = findOwned(userId, groupId);
        if (!group.getName().equalsIgnoreCase(name)) {
            ensureUnique(userId, name);
        }
        group.setName(name);
        return CardGroupResponse.from(groupRepository.save(group));
    }

    @Transactional
    public void delete(UUID userId, UUID groupId) {
        CardGroup group = findOwned(userId, groupId);
        groupRepository.delete(group);
    }

    private CardGroup findOwned(UUID userId, UUID groupId) {
        return groupRepository.findByIdAndUserId(groupId, userId)
                .orElseThrow(() -> new RuntimeException("Card group not found"));
    }

    private void ensureUnique(UUID userId, String name) {
        if (groupRepository.existsByUserIdAndNameIgnoreCase(userId, name)) {
            throw new RuntimeException("이미 존재하는 그룹명입니다.");
        }
    }

    private String normalizeName(String rawName) {
        String name = rawName == null ? "" : rawName.trim();
        if (name.isBlank()) {
            throw new RuntimeException("그룹명을 입력해 주세요.");
        }
        if (name.length() > MAX_GROUP_NAME_LENGTH) {
            throw new RuntimeException("그룹명은 60자 이하로 입력해 주세요.");
        }
        return name;
    }
}

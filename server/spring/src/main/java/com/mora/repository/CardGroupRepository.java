package com.mora.repository;

import com.mora.entity.CardGroup;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

import java.util.List;
import java.util.Optional;
import java.util.UUID;

@Repository
public interface CardGroupRepository extends JpaRepository<CardGroup, UUID> {
    List<CardGroup> findByUserIdOrderByCreatedAtAsc(UUID userId);

    boolean existsByUserIdAndNameIgnoreCase(UUID userId, String name);

    Optional<CardGroup> findByIdAndUserId(UUID id, UUID userId);
}

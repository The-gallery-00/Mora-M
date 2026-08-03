package com.mora.dto;

import com.mora.entity.Poster;
import lombok.Getter;
import lombok.Setter;

import java.math.BigDecimal;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.util.UUID;

@Getter
@Setter
public class PosterResponse {
    private Integer id;
    private UUID userId;
    private String docType;
    private BigDecimal classificationConfidence;
    private String title;
    private String organizerName;
    private LocalDate eventStartDate;
    private LocalDate eventEndDate;
    private String contactPhone;
    private String contactEmail;
    private String location;
    private String fee;
    private String websiteUrl;
    private String description;
    private String rawText;
    private String parsedJson;
    private String rawJson;
    private LocalDateTime createdAt;
    private LocalDateTime updatedAt;
    private Double similarity;

    public static PosterResponse from(Poster poster) {
        PosterResponse response = new PosterResponse();
        response.setId(poster.getId());
        response.setUserId(poster.getUserId());
        response.setDocType(poster.getDocType());
        response.setClassificationConfidence(poster.getClassificationConfidence());
        response.setTitle(poster.getTitle());
        response.setOrganizerName(poster.getOrganizerName());
        response.setEventStartDate(poster.getEventStartDate());
        response.setEventEndDate(poster.getEventEndDate());
        response.setContactPhone(poster.getContactPhone());
        response.setContactEmail(poster.getContactEmail());
        response.setLocation(poster.getLocation());
        response.setFee(poster.getFee());
        response.setWebsiteUrl(poster.getWebsiteUrl());
        response.setDescription(poster.getDescription());
        response.setRawText(poster.getRawText());
        response.setParsedJson(poster.getParsedJson());
        response.setRawJson(poster.getRawJson());
        response.setCreatedAt(poster.getCreatedAt());
        response.setUpdatedAt(poster.getUpdatedAt());
        return response;
    }
}

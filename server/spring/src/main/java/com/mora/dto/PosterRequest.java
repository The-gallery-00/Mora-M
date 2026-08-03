package com.mora.dto;

import lombok.AllArgsConstructor;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;

import java.math.BigDecimal;
import java.util.List;

@Getter
@Setter
@NoArgsConstructor
@AllArgsConstructor
public class PosterRequest {
    private String docType;
    private BigDecimal classificationConfidence;
    private String title;
    private String organizerName;
    private String eventStartDate;
    private String eventEndDate;
    private String contactPhone;
    private String contactEmail;
    private String location;
    private String fee;
    private String websiteUrl;
    private String description;
    private List<String> rawText;
    private String parsedJson;
    private String rawJson;
}

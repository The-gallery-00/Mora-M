package com.mora.dto;

public record OAuthProfile(
        String provider,
        String email,
        String name,
        String picture
) {
}

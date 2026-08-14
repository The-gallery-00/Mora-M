package com.mora.dto;

public class ChangeNameRequest {

    private String name;

    public ChangeNameRequest() {
    }

    public ChangeNameRequest(String name) {
        this.name = name;
    }

    public String getName() {
        return name;
    }

    public void setName(String name) {
        this.name = name;
    }
}

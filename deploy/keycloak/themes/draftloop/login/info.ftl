<#-- Keycloak's info page, with the two pages an invited person meets reworded as one step each:
     the invite link's confirmation before the password form, and the end of it. Every other
     info page keeps Keycloak's wording. Links show as buttons. -->
<#import "template.ftl" as layout>
<#assign invite = (requiredActions?? && requiredActions?size == 1 && requiredActions[0] == "UPDATE_PASSWORD" && actionUri?has_content)>
<#assign passwordSet = (pageRedirectUri?has_content && message?? && message.summary == msg("accountUpdatedMessage"))>
<@layout.registrationLayout displayMessage=false; section>
    <#if section = "header">
        <#if invite>
            ${msg("draftloopInviteTitle")}
        <#elseif passwordSet>
            ${msg("draftloopPasswordSetTitle")}
        <#elseif messageHeader??>
            ${kcSanitize(msg("${messageHeader}"))?no_esc}
        <#else>
            ${message.summary}
        </#if>
    <#elseif section = "form">
    <div id="kc-info-message">
        <#if invite>
            <p class="instruction">${msg("draftloopInviteText")}</p>
            <a id="kc-proceed" class="${properties.kcButtonClass!} ${properties.kcButtonPrimaryClass!} ${properties.kcButtonBlockClass!}" href="${actionUri}">${msg("draftloopInviteButton")}</a>
        <#elseif passwordSet>
            <p class="instruction">${msg("draftloopPasswordSetText")}</p>
            <a id="kc-continue" class="${properties.kcButtonClass!} ${properties.kcButtonPrimaryClass!} ${properties.kcButtonBlockClass!}" href="${pageRedirectUri}">${msg("draftloopPasswordSetButton")}</a>
        <#else>
            <p class="instruction">${message.summary}<#if requiredActions??><#list requiredActions>: <b><#items as reqActionItem>${kcSanitize(msg("requiredAction.${reqActionItem}"))?no_esc}<#sep>, </#items></b></#list><#else></#if></p>
            <#if skipLink??>
            <#else>
                <#if pageRedirectUri?has_content>
                    <p><a href="${pageRedirectUri}">${msg("backToApplication")}</a></p>
                <#elseif actionUri?has_content>
                    <p><a href="${actionUri}">${msg("proceedWithAction")}</a></p>
                <#elseif (client.baseUrl)?has_content>
                    <p><a href="${client.baseUrl}">${msg("backToApplication")}</a></p>
                </#if>
            </#if>
        </#if>
    </div>
    </#if>
</@layout.registrationLayout>

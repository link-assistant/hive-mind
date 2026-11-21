# Error codes

> For the complete documentation index, see [llms.txt](/llms.txt). Markdown versions of documentation pages are available by appending `.md` to the page URL.

This guide includes an overview on error codes you might see from both the [API](https://developers.openai.com/api/docs/concepts) and our [official Python library](https://developers.openai.com/api/docs/libraries#install-an-official-sdk). Each error code mentioned in the overview has a dedicated section with further guidance.

## API errors

| Code                                                         | Overview                                                                                                                                                                                                                                                                                          |
| ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 400 - Invalid `service_tier` argument                        | **Cause:** The requested or resolved service tier is not allowed for the project. <br /> **Solution:** Set `service_tier` to a tier allowed for the project, or update the allowed service tiers in [project settings](https://platform.openai.com/settings/).                                    |
| 401 - Invalid Authentication                                 | **Cause:** Invalid Authentication <br /> **Solution:** Ensure the correct [API key](https://platform.openai.com/settings/organization/api-keys) and requesting organization are being used.                                                                                                       |
| 401 - Incorrect API key provided                             | **Cause:** The requesting API key is not correct. <br /> **Solution:** Ensure the API key used is correct, clear your browser cache, or [generate a new one](https://platform.openai.com/settings/organization/api-keys).                                                                         |
| 401 - You must be a member of an organization to use the API | **Cause:** Your account is not part of an organization. <br /> **Solution:** Contact us to get added to a new organization or ask your organization manager to [invite you to an organization](https://platform.openai.com/settings/organization/people).                                         |
| 401 - IP not authorized                                      | **Cause:** Your request IP does not match the configured IP allowlist for your project or organization. <br /> **Solution:** Send the request from the correct IP, or update your [IP allowlist settings](https://platform.openai.com/settings/organization/security/ip-allowlist).               |
| 403 - Country, region, or territory not supported            | **Cause:** You are accessing the API from an unsupported country, region, or territory. <br /> **Solution:** Please see [this page](https://developers.openai.com/api/docs/supported-countries) for more information.                                                                                                          |
| 429 - Credit balance exhausted                               | **Code:** `credit_balance_exhausted` <br /> **Cause:** Your organization has no prepaid credits remaining. <br /> **Solution:** [Add credits](https://platform.openai.com/settings/organization/billing) to continue using the API.                                                               |
| 429 - Rate limit reached for requests                        | **Cause:** You are sending requests too quickly. <br /> **Solution:** Pace your requests and follow the `Retry-After` header when it's present. Read the [Rate limit guide](https://developers.openai.com/api/docs/guides/rate-limits).                                                                                        |
| 429 - Slow down                                              | **Type:** `rate_limit_error` <br /> **Code:** `slow_down` <br /> **Cause:** Your request rate increased too quickly. <br /> **Solution:** Follow the `Retry-After` header when it's present, reduce your request rate, and increase it gradually.                                                 |
| 429 - Organization spend limit reached                       | **Code:** `organization_spend_limit_exceeded` <br /> **Cause:** Your organization reached its enforced spend limit. <br /> **Solution:** Increase or remove your [organization spend limit](https://platform.openai.com/settings/organization/limits).                                            |
| 429 - Project spend limit reached                            | **Code:** `project_spend_limit_exceeded` <br /> **Cause:** Your project reached its enforced spend limit. <br /> **Solution:** Increase or remove the spend limit in your [project settings](https://platform.openai.com/settings/).                                                              |
| 429 - Organization usage limit reached                       | **Code:** `organization_usage_limit_exceeded` <br /> **Cause:** Your organization reached its OpenAI-assigned usage limit. <br /> **Solution:** Request a higher [approved usage limit](https://platform.openai.com/settings/organization/limits) or [contact support](https://help.openai.com/). |
| 500 - The server had an error while processing your request  | **Cause:** Issue on our servers. <br /> **Solution:** Retry your request after a brief wait and contact us if the issue persists. Check the [status page](https://status.openai.com/).                                                                                                            |
| 503 - Model temporarily overloaded                           | **Type:** `service_unavailable_error` <br /> **Code:** `server_is_overloaded` <br /> **Cause:** The requested model is temporarily overloaded. <br /> **Solution:** Follow the `Retry-After` header when it's present, then retry your request.                                                   |

For billing-related errors, inspect `error.code` to identify the specific cause. The broader `error.type` can still be `insufficient_quota`.

Retrying billing, spend, or quota errors won't restore API access. Update the relevant credits or limits before sending another request.

## WebSocket mode errors

If you are using [the Responses API WebSocket mode](https://developers.openai.com/api/docs/guides/websocket-mode), you may see these additional errors:

- `previous_response_not_found`: The `previous_response_id` cannot be resolved from available state. Retry with full input context and `previous_response_id` set to `null`.
- `websocket_connection_limit_reached`: The connection hit the 60-minute limit. Open a new WebSocket connection and continue.



### 400 - Invalid service_tier argument


The API returns the message "Invalid `service_tier` argument: The requested service tier is not allowed for this project." as an `invalid_request_error` with `error.param` set to `service_tier` when a request selects or resolves to a service tier that is not allowed for the project.

Project restrictions apply to the `default`, `flex`, and `priority` service tiers. The `fast` service tier is evaluated as `priority`. Requests that omit `service_tier` or set it to `auto` can also return this error if they resolve to a disallowed tier. Scale Tier remains outside this project policy.

To resolve this error:

- Check the allowed service tiers in [project settings](https://platform.openai.com/settings/) and [organization settings](https://platform.openai.com/settings/organization/general#service-tiers). Projects cannot enable tiers blocked by the organization.
- Set `service_tier` to a tier allowed for the project.
- If the request uses `auto` or omits `service_tier`, update the project settings so the resolved tier is allowed.







### 401 - Invalid Authentication


This error message indicates that your authentication credentials are invalid. This could happen for several reasons, such as:

- You are using a revoked API key.
- You are using a different API key than the one assigned to the requesting organization or project.
- You are using an API key that does not have the required permissions for the endpoint you are calling.

To resolve this error, please follow these steps:

- Check that you are using the correct API key and organization ID in your request header. You can find your API key and organization ID in [your account settings](https://platform.openai.com/settings/organization/api-keys) or your can find specific project related keys under [General settings](https://platform.openai.com/settings/organization/general) by selecting the desired project.
- If you are unsure whether your API key is valid, you can [generate a new one](https://platform.openai.com/settings/organization/api-keys). Make sure to replace your old API key with the new one in your requests and follow our [best practices guide](https://help.openai.com/en/articles/5112595-best-practices-for-api-key-safety).







### 401 - Incorrect API key provided


This error message indicates that the API key you are using in your request is not correct. This could happen for several reasons, such as:

- Your API key contains a typo or an extra space.
- You are using an API key that belongs to a different organization or project.
- You are using an API key that has been deleted or deactivated.
- An old, revoked API key might be cached locally.

To resolve this error, please follow these steps:

- Try clearing your browser's cache and cookies, then try again.
- Check that you are using the correct API key in your request header.
- If you are unsure whether your API key is correct, you can [generate a new one](https://platform.openai.com/settings/organization/api-keys). Make sure to replace your old API key in your codebase and follow our [best practices guide](https://help.openai.com/en/articles/5112595-best-practices-for-api-key-safety).







### 401 - You must be a member of an organization to use the API


This error message indicates that your account is not part of an organization. This could happen for several reasons, such as:

- You have left or been removed from your previous organization.
- You have left or been removed from your previous project.
- Your organization has been deleted.

To resolve this error, please follow these steps:

- If you have left or been removed from your previous organization, you can either request a new organization or get invited to an existing one.
- To request a new organization, reach out to us via help.openai.com
- Existing organization owners can invite you to join their organization via the [Team page](https://platform.openai.com/settings/organization/people) or can create a new project from the [Settings page](https://platform.openai.com/settings/organization/general).
- If you have left or been removed from a previous project, you can ask your organization or project owner to add you to it, or create a new one.







### 429 - Credit balance exhausted


The `credit_balance_exhausted` error indicates that your organization's prepaid credit balance is depleted.

To restore API access, [add credits in your billing settings](https://platform.openai.com/settings/organization/billing).







### 429 - Rate limit reached for requests


This error message indicates that you have hit your assigned rate limit for the API. This means that you have submitted too many tokens or requests in a short period of time and have exceeded the number of requests allowed. This could happen for several reasons, such as:

- You are using a loop or a script that makes frequent or concurrent requests.
- You are sharing your API key with other users or applications.
- You are using a free plan that has a low rate limit.
- You have reached the defined limit on your project

To resolve this error, please follow these steps:

- Pace your requests and avoid making unnecessary or redundant calls.
- If a `Retry-After` header is present, wait at least as long as it specifies before trying again. If it's missing, use exponential backoff with jitter and limit the number of retries. SDK support for long server delays varies by version and configuration. Read more in our [rate limit guide](https://developers.openai.com/api/docs/guides/rate-limits#retrying-with-exponential-backoff).
- If you are sharing your organization with other users, note that limits are applied per organization and not per user. It is worth checking on the usage of the rest of your team as this will contribute to the limit.
- If you are using a free or low-tier plan, consider upgrading to a pay-as-you-go plan that offers a higher rate limit. You can compare the restrictions of each plan in our [rate limit guide](https://developers.openai.com/api/docs/guides/rate-limits).
- Reach out to your organization owner to increase the rate limits on your project







### 429 - Slow down


A `429` response with the `rate_limit_error` type and `slow_down` code indicates that your request rate increased faster than the service can safely handle. It can occur even when your traffic is within its requests-per-minute and tokens-per-minute limits.

As a rule of thumb, once your traffic reaches 1 million input tokens per minute (TPM), increase it by no more than 50% every 15 minutes. The exact point at which the ramp-rate limit applies can vary by model and traffic conditions.

To resolve this error:

- If a `Retry-After` header is present, wait at least as long as it specifies before retrying. If it's missing, increase the delay between retries and add a small random delay.
- Reduce your request rate, then increase it gradually.
- Keep your traffic pattern steady to reduce the chance of another `slow_down` error.

Enterprise customers whose pay-as-you-go traffic routinely hits ramp-rate limits can consider [Scale Tier](https://openai.com/api-scale-tier/) for more predictable capacity on eligible models. For GPT-5.6 and later models, see [Reserved Tier](https://openai.com/api-reserved-tier/). These capacity options don't replace the recovery steps above: continue to follow `Retry-After` when it's present and ramp traffic gradually.







### 429 - Organization spend limit reached


The `organization_spend_limit_exceeded` error indicates that your organization reached its enforced monthly [spend limit](https://developers.openai.com/api/docs/guides/spend-limits). The limit applies to API traffic across all projects in the organization.

To restore API access, increase or remove the limit in your [organization limit settings](https://platform.openai.com/settings/organization/limits). Otherwise, access resumes after the monthly limit resets.







### 429 - Project spend limit reached


The `project_spend_limit_exceeded` error indicates that your project reached its enforced monthly [spend limit](https://developers.openai.com/api/docs/guides/spend-limits). Other projects can continue unless their own limit or the organization limit is also reached.

To restore API access, increase or remove the limit in your [project settings](https://platform.openai.com/settings/). Otherwise, access resumes after the monthly limit resets.







### 429 - Organization usage limit reached


The `organization_usage_limit_exceeded` error indicates that your organization reached its OpenAI-assigned monthly [usage limit](https://developers.openai.com/api/docs/guides/rate-limits#usage-tiers). This limit is separate from organization and project spend limits that you configure.

To restore API access, request a higher [approved usage limit](https://platform.openai.com/settings/organization/limits) or [contact support](https://help.openai.com/).







### 503 - Model temporarily overloaded


A `503` response with the `service_unavailable_error` type and `server_is_overloaded` code indicates that the requested model does not have enough capacity to process your request at the moment.

If a `Retry-After` header is present, wait at least as long as it specifies before retrying. If it's missing, increase the delay between retries. If the error continues, check the [status page](https://status.openai.com/) for an active incident.





## Python library error types

Python raises `RateLimitError` for `429` responses and `InternalServerError` for `503` responses. If your handler previously caught only one of these classes for throttling and overload, handle both and inspect `error.code`. Video overload, for example, now returns `503` where it previously returned `429`. See [migration guidance](https://developers.openai.com/api/docs/guides/rate-limits#update-existing-error-handlers) for the endpoint-specific changes.

| Type                     | Overview                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| APIConnectionError       | **Cause:** Issue connecting to our services. <br /> **Solution:** Check your network settings, proxy configuration, SSL certificates, or firewall rules.                                                                                                                                                                                                                                                                                 |
| APITimeoutError          | **Cause:** Request timed out. <br /> **Solution:** Retry your request after a brief wait and contact us if the issue persists.                                                                                                                                                                                                                                                                                                           |
| AuthenticationError      | **Cause:** Your API key or token was invalid, expired, or revoked. <br /> **Solution:** Check your API key or token and make sure it is correct and active. You may need to generate a new one from your account dashboard.                                                                                                                                                                                                              |
| BadRequestError          | **Cause:** Your request was malformed or missing some required parameters, such as a token or an input. <br /> **Solution:** The error message should advise you on the specific error made. Check the [documentation](https://developers.openai.com/api/reference/overview) for the specific API method you are calling and make sure you are sending valid and complete parameters. You may also need to check the encoding, format, or size of your request data. |
| ConflictError            | **Cause:** The resource was updated by another request. <br /> **Solution:** Try to update the resource again and ensure no other requests are trying to update it.                                                                                                                                                                                                                                                                      |
| InternalServerError      | **Cause:** Issue on our side. <br /> **Solution:** Retry your request after a brief wait and contact us if the issue persists.                                                                                                                                                                                                                                                                                                           |
| NotFoundError            | **Cause:** Requested resource does not exist. <br /> **Solution:** Ensure you are the correct resource identifier.                                                                                                                                                                                                                                                                                                                       |
| PermissionDeniedError    | **Cause:** You don't have access to the requested resource. <br /> **Solution:** Ensure you are using the correct API key, organization ID, and resource ID.                                                                                                                                                                                                                                                                             |
| RateLimitError           | **Cause:** You have hit your assigned rate limit or increased traffic too quickly. <br /> **Solution:** Pace your requests and follow `Retry-After` when it's present, subject to your retry limits. Read more in our [Rate limit guide](https://developers.openai.com/api/docs/guides/rate-limits#retrying-with-exponential-backoff).                                                                                                                                |
| UnprocessableEntityError | **Cause:** Unable to process the request despite the format being correct. <br /> **Solution:** Please try the request again.                                                                                                                                                                                                                                                                                                            |



### APIConnectionError


An `APIConnectionError` indicates that your request could not reach our servers or establish a secure connection. This could be due to a network issue, a proxy configuration, an SSL certificate, or a firewall rule.

If you encounter an `APIConnectionError`, please try the following steps:

- Check your network settings and make sure you have a stable and fast internet connection. You may need to switch to a different network, use a wired connection, or reduce the number of devices or applications using your bandwidth.
- Check your proxy configuration and make sure it is compatible with our services. You may need to update your proxy settings, use a different proxy, or bypass the proxy altogether.
- Check your SSL certificates and make sure they are valid and up-to-date. You may need to install or renew your certificates, use a different certificate authority, or disable SSL verification.
- Check your firewall rules and make sure they are not blocking or filtering our services. You may need to modify your firewall settings.
- If appropriate, check that your container has the correct permissions to send and receive traffic.
- If the issue persists, check out our persistent errors next steps section.







### APITimeoutError


A `APITimeoutError` error indicates that your request took too long to complete and our server closed the connection. This could be due to a network issue, a heavy load on our services, or a complex request that requires more processing time.

If you encounter a `APITimeoutError` error, please try the following steps:

- Wait a few seconds and retry your request. Sometimes, the network congestion or the load on our services may be reduced and your request may succeed on the second attempt.
- Check your network settings and make sure you have a stable and fast internet connection. You may need to switch to a different network, use a wired connection, or reduce the number of devices or applications using your bandwidth.
- If the issue persists, check out our persistent errors next steps section.







### AuthenticationError


An `AuthenticationError` indicates that your API key or token was invalid, expired, or revoked. This could be due to a typo, a formatting error, or a security breach.

If you encounter an `AuthenticationError`, please try the following steps:

- Check your API key or token and make sure it is correct and active. You may need to generate a new key from the API Key dashboard, ensure there are no extra spaces or characters, or use a different key or token if you have multiple ones.
- Ensure that you have followed the correct formatting.







### BadRequestError



An `BadRequestError` (formerly `InvalidRequestError`) indicates that your request was malformed or missing some required parameters, such as a token or an input. This could be due to a typo, a formatting error, or a logic error in your code.

If you encounter an `BadRequestError`, please try the following steps:

- Read the error message carefully and identify the specific error made. The error message should advise you on what parameter was invalid or missing, and what value or format was expected.
- Check the [API Reference](https://developers.openai.com/api/reference/overview) for the specific API method you were calling and make sure you are sending valid and complete parameters. You may need to review the parameter names, types, values, and formats, and ensure they match the documentation.
- Check the encoding, format, or size of your request data and make sure they are compatible with our services. You may need to encode your data in UTF-8, format your data in JSON, or compress your data if it is too large.
- Test your request using a tool like Postman or curl and make sure it works as expected. You may need to debug your code and fix any errors or inconsistencies in your request logic.
- If the issue persists, check out our persistent errors next steps section.







### InternalServerError


An `InternalServerError` indicates that something went wrong on our side when processing your request. This could be due to a temporary error, a bug, or a system outage.

We apologize for any inconvenience and we are working hard to resolve any issues as soon as possible. You can [check our system status page](https://status.openai.com/) for more information.

If you encounter an `InternalServerError`, please try the following steps:

- Wait a few seconds and retry your request. Sometimes, the issue may be resolved quickly and your request may succeed on the second attempt.
- Check our status page for any ongoing incidents or maintenance that may affect our services. If there is an active incident, please follow the updates and wait until it is resolved before retrying your request.
- If the issue persists, check out our Persistent errors next steps section.

Our support team will investigate the issue and get back to you as soon as possible. Note that our support queue times may be long due to high demand. You can also [post in our Community Forum](https://community.openai.com) but be sure to omit any sensitive information.







### RateLimitError


A `RateLimitError` indicates that you have hit your assigned rate limit. This means that you have sent too many tokens or requests in a given period of time, and our services have temporarily blocked you from sending more.

We impose rate limits to ensure fair and efficient use of our resources and to prevent abuse or overload of our services.

If you encounter a `RateLimitError`, please try the following steps:

- Send fewer tokens or requests or slow down. You may need to reduce the frequency or volume of your requests, batch your tokens, or use exponential backoff when `Retry-After` isn't present. You can read our [Rate limit guide](https://developers.openai.com/api/docs/guides/rate-limits) for more details.
- When `Retry-After` is present, wait at least as long as it specifies before retrying. The Python library can stop automatic retries when a server delay exceeds its supported limit. If you retry at the application level, respect the original delay and account for SDK retries.
- You can also check your API usage statistics from your account dashboard.





### Persistent errors

If the issue persists, [contact our support team via chat](https://help.openai.com/en/) and provide them with the following information:

- The model you were using
- The error message and code you received
- The request data and headers you sent
- The timestamp and timezone of your request
- Any other relevant details that may help us diagnose the issue

Our support team will investigate the issue and get back to you as soon as possible. Note that our support queue times may be long due to high demand. You can also [post in our Community Forum](https://community.openai.com) but be sure to omit any sensitive information.

### Handling errors

We advise you to programmatically handle errors returned by the API. To do so, you may want to use a code snippet like below:

```javascript
import OpenAI from "openai";

const client = new OpenAI();

try {
  const response = await client.responses.create({
    model: "gpt-6-astra",
    input: "Hello world",
  });
  console.log(response.output_text);
} catch (error) {
  if (error instanceof OpenAI.APIConnectionError) {
    console.error("Failed to connect to the OpenAI API:", error.message);
  } else if (error instanceof OpenAI.RateLimitError) {
    console.error("OpenAI API request exceeded its rate limit:", error.message);
  } else if (error instanceof OpenAI.APIError) {
    console.error("OpenAI API returned an error:", error.status, error.message);
  } else {
    throw error;
  }
}
```

```python
import openai
from openai import OpenAI

client = OpenAI()

try:
    response = client.responses.create(model="gpt-6-astra", input="Hello world")
except openai.APIConnectionError as e:
    print(f"Failed to connect to OpenAI API: {e}")
except openai.RateLimitError as e:
    print(f"OpenAI API request exceeded rate limit: {e}")
except openai.APIError as e:
    print(f"OpenAI API returned an API Error: {e}")
else:
    print(response.output_text)
```

```go
package main

import (
	"context"
	"errors"
	"fmt"

	"github.com/openai/openai-go/v3"
	"github.com/openai/openai-go/v3/responses"
)

func main() {
	client := openai.NewClient()
	response, err := client.Responses.New(context.Background(), responses.ResponseNewParams{
		Model: "gpt-6-astra",
		Input: responses.ResponseNewParamsInputUnion{OfString: openai.String("Hello world")},
	})
	if err != nil {
		var apiError *openai.Error
		if errors.As(err, &apiError) {
			fmt.Println("OpenAI API returned an API error:", apiError)
			return
		}
		fmt.Println("Failed to connect to OpenAI API:", err)
		return
	}
	fmt.Println(response.OutputText())
}
```

```java
import com.openai.client.OpenAIClient;
import com.openai.client.okhttp.OpenAIOkHttpClient;
import com.openai.errors.OpenAIServiceException;
import com.openai.models.responses.ResponseCreateParams;

try {
  var response =
      client
          .responses()
          .create(
              ResponseCreateParams.builder().model("gpt-6-astra").input("Say hello.").build());

  response.output().stream()
      .flatMap(item -> item.message().stream())
      .flatMap(message -> message.content().stream())
      .flatMap(content -> content.outputText().stream())
      .forEach(text -> System.out.println(text.text()));
} catch (OpenAIServiceException error) {
  System.err.println(error.getMessage());
}
```

```ruby
require "openai"

client = OpenAI::Client.new
begin
  response = client.responses.create(model: "gpt-6-astra", input: "Say hello.")
  puts(response.output_text)
rescue OpenAI::Errors::APIError => error
  warn(error.message)
end
```
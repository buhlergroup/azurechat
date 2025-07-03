# Azure Chat by Bühler Group

1. [Introduction](#introduction)
1. [Solution Overview](/docs/1-introduction.md)
1. [Deploy to Azure](#deploy-to-azure)
1. [Run from your local machine](/docs/3-run-locally.md)
1. [Deploy to Azure with GitHub Actions](/docs/4-deploy-to-azure.md)
1. [Add identity provider](/docs/5-add-identity.md)
1. [Chatting with your file](/docs/6-chat-over-file.md)
1. [Persona](/docs/6-persona.md)
1. [Extensions](/docs/8-extensions.md)
1. [Environment variables](/docs/9-environment-variables.md)
1. [Migration considerations](/docs/migration.md)
1. [🧠 Reasoning Models & Summaries](/docs/reasoning-summaries.md)
1. [🎯 Environment-Based Model Selection](/docs/environment-based-model-selection.md)
1. [🚀 Azure OpenAI v1 Responses API](/docs/azure-openai-v1-responses-api.md)

# Introduction

_Azure Chat powered by Azure Open AI Service_

![](/docs/images/intro.png)

_Azure Chat powered by Azure Open AI Service_ is a that allows organisations to deploy a private chat tenant in their Azure Subscription, with a familiar user experience and the added capabilities of chatting over your data and files.

## ✨ Latest Features

### 🧠 Advanced Reasoning Models
- **OpenAI o3, o3-mini, o4-mini** support with reasoning summaries
- **Auto-summarization** of model reasoning process
- **Expandable reasoning thoughts** in the chat interface
- **Multiple effort levels** (low, medium, high) for reasoning tasks

### 🎯 Smart Model Selection
- **Environment-based model availability** - only configured models appear in the selector
- **Automatic model filtering** based on deployment environment variables
- **Support for latest models**: GPT-4.1, GPT-4.1 Mini, GPT-4.1 Nano, o3, o4-mini, Computer Use Preview
- **Dynamic model configuration** without code changes

### 🚀 Azure OpenAI v1 Responses API
- **Enhanced streaming capabilities** with rich event types
- **Background task support** for long-running operations
- **Improved function calling** and tool integration
- **Multimodal support** with image generation and analysis
- **MCP (Model Context Protocol)** server integration

### 🛠️ Enhanced Debugging
- **VS Code launch configurations** for full-stack debugging
- **Comprehensive debug logging** for API responses and reasoning
- **Turbopack support** for faster development
- **Multiple debugging modes**: server-side, client-side, and full-stack

### 📁 SharePoint Integration
- **Direct SharePoint file access** for persona knowledge bases
- **SharePoint group-based access control** for secure document sharing
- **Real-time file picker** with native SharePoint interface
- **Automatic document processing** from SharePoint libraries
- **Secure token-based authentication** for SharePoint resources

## Benefits

1. **Private**: Deployed in your Azure tenancy, allowing you to isolate it to your Azure tenant.

2. **Controlled**: Network traffic can be fully isolated to your network and other enterprise grade authentication security features are built in.

3. **Value**: Deliver added business value with your own internal data sources (plug and play) or integrate with your internal services.

4. **Advanced AI**: Support for cutting-edge reasoning models with transparent thinking processes.

5. **Flexible**: Environment-based model selection allows easy configuration without code changes.

6. **Enterprise Ready**: Native SharePoint integration for secure document access and collaboration.

# Deploy to Azure

You can provision Azure resources for the using either the Azure Developer CLI or the Deploy to Azure button below. Regardless of the method you chose you will still need set up an [identity provider and specify an admin user](/docs/5-add-identity.md)

## Deployment Options

You can deploy the application using one of the following options:

- [1. Azure Developer CLI](#azure-developer-cli)
- [2. Azure Portal Deployment](#azure-portal-deployment)

### 1. Azure Developer CLI

> [!IMPORTANT]
> This section will create Azure resources and deploy the solution from your local environment using the Azure Developer CLI. Note that you do not need to clone this repo to complete these steps.

1. Download the [Azure Developer CLI](https://learn.microsoft.com/en-us/azure/developer/azure-developer-cli/overview)
1. If you have not cloned this repo, run `azd init -t microsoft/azurechat`. If you have cloned this repo, just run 'azd init' from the repo root directory.
1. Run `azd up` to provision and deploy the application

```pwsh
azd init -t microsoft/azurechat
azd up

# if you are wanting to see logs run with debug flag
azd up --debug
```

### 2. Azure Portal Deployment

> [!WARNING]
> This button will only create Azure resources. You will still need to deploy the application by following the [deploy to Azure section](/docs/4-deploy-to-azure.md) to build and deploy the application using GitHub actions.

Click on the Deploy to Azure button to deploy the Azure resources for the application.

[![Deploy to Azure](https://aka.ms/deploytoazurebutton)](https://aka.ms/anzappazurechatgpt)

> [!IMPORTANT]
> The application is protected by an identity provider and follow the steps in [Add an identity provider](/docs/5-add-identity.md) section for adding authentication to your app.

# 🛠️ Development & Debugging

## Quick Start for Developers

1. **Clone and Setup**:
   ```bash
   git clone https://github.com/buhlergroup/azurechat
   cd azurechat/src
   cp .env.example .env.local
   # Configure your environment variables
   npm install
   ```

2. **Run with Debugging**:
   ```bash
   # Standard development with Turbopack
   npm run dev
   
   # Debug mode without Turbopack
   npm run dev:debug
   
   # Debug mode with Turbopack and Node inspector
   npm run dev:turbo-debug
   ```

## VS Code Debugging

The project includes preconfigured VS Code debugging setups in `.vscode/launch.json`:

### Debug Configurations

- **Next.js: debug server-side** - Debug backend API routes and server-side rendering
- **Next.js: debug client-side** - Debug React components in Chrome
- **Next.js: debug full stack** - Debug both frontend and backend simultaneously

### Debugging Features

- **Breakpoint support** in TypeScript/JavaScript
- **Variable inspection** and watch expressions
- **Call stack navigation** for API routes and React components
- **Console output** with integrated terminal
- **Hot reload** with debugging active

## Model Development & Testing

### Environment-Based Model Selection
Configure which models appear in your chat interface by setting environment variables:

```bash
# Enable specific models in .env.local
AZURE_OPENAI_API_O3_DEPLOYMENT_NAME=o3-deployment
AZURE_OPENAI_API_GPT41_DEPLOYMENT_NAME=gpt41-deployment
AZURE_OPENAI_API_GPT41_MINI_DEPLOYMENT_NAME=gpt41-mini-deployment
```

Only models with configured deployment names will appear in the model selector.

### Reasoning Models
Test advanced reasoning capabilities with o3, o3-mini, and o4-mini models:

```bash
# Configure reasoning model deployment
AZURE_OPENAI_API_O3_DEPLOYMENT_NAME=your-o3-deployment
```

Features include:
- **Reasoning summaries** with expandable thought processes
- **Effort level control** (low/medium/high)
- **Debug logging** for reasoning content extraction

### v1 Responses API
Enable enhanced API features:

```bash
# Configure v1 API models
AZURE_OPENAI_API_VERSION=preview
AZURE_OPENAI_API_GPT41_DEPLOYMENT_NAME=gpt-4.1
AZURE_OPENAI_GPT_IMAGE_DEPLOYMENT_NAME=gpt-image-1
```

Provides:
- **Background task support** for long operations
- **Enhanced streaming** with detailed events
- **Function calling improvements**
- **MCP server integration**

### SharePoint Integration
Configure SharePoint document access for personas:

```bash
# Enable SharePoint integration in .env.local
NEXT_PUBLIC_SHAREPOINT_URL=https://yourtenant.sharepoint.com
```

Features include:
- **Direct file access** from SharePoint libraries
- **Group-based access control** for secure sharing
- **Native file picker** interface
- **Automatic document processing** for persona knowledge bases

## Troubleshooting

### Common Issues

1. **Models not appearing**: Check environment variables are set correctly
2. **Debugging not working**: Ensure VS Code is configured and ports are available
3. **Reasoning not showing**: Verify model supports reasoning and deployment is correct
4. **API errors**: Check Azure OpenAI resource region and API version compatibility
5. **SharePoint access issues**: Verify SharePoint URL and user permissions are configured correctly

### Debug Logging

Enable detailed logging for troubleshooting:

```javascript
// Check console for detailed model and API information
console.log("🚀 Model configuration:", modelConfig);
console.log("🧠 Reasoning content:", reasoningContent);
console.log("📡 API response events:", streamEvents);
```

See our [detailed debugging documentation](/docs/azure-openai-v1-responses-api.md#debug-logging) for more information.

[Next](./docs/1-introduction.md)

# 📚 Documentation

## Core Features
- [🏃 Run Locally](/docs/3-run-locally.md) - Local development setup
- [🚀 Deploy to Azure](/docs/4-deploy-to-azure.md) - Production deployment
- [🔐 Identity Provider](/docs/5-add-identity.md) - Authentication setup
- [📄 Chat over Files](/docs/6-chat-over-file.md) - Document chat functionality
- [👤 Personas](/docs/6-persona.md) - AI assistant customization with SharePoint integration
- [🔌 Extensions](/docs/8-extensions.md) - Extensibility framework

## Advanced Features
- [🧠 Reasoning Models & Summaries](/docs/reasoning-summaries.md) - o3, o3-mini, o4-mini with thought processes
- [🎯 Environment-Based Model Selection](/docs/environment-based-model-selection.md) - Dynamic model configuration
- [🚀 Azure OpenAI v1 Responses API](/docs/azure-openai-v1-responses-api.md) - Enhanced API features

## Configuration & Migration
- [⚙️ Environment Variables](/docs/9-environment-variables.md) - Complete configuration reference
- [🔄 Migration Guide](/docs/migration.md) - Upgrade instructions and breaking changes

## API References
- [📡 OpenAI SDK Migration](/docs/openai-sdk-migration.md) - SDK upgrade guide
- [🔄 OpenAI Responses API Streaming](/docs/openai-responses-api-streaming.md) - Streaming implementation
- [📊 Chat API Sequence Diagram](/docs/chat-api-sequence-diagram.md) - API flow documentation

## Latest Model Support

### Reasoning Models
- **o3**: Advanced reasoning with detailed thought summaries
- **o3-mini**: Efficient reasoning for faster responses  
- **o4-mini**: Latest compact reasoning model

### Standard Models
- **GPT-4.1**: Latest flagship model
- **GPT-4.1 Mini**: Efficient version of GPT-4.1
- **GPT-4.1 Nano**: Ultra-fast responses
- **Computer Use Preview**: Advanced automation capabilities
- **GPT Image 1**: Enhanced image generation and analysis

### Enterprise Features
- **SharePoint Integration**: Direct access to corporate document libraries
- **Group-based Access Control**: Secure sharing via SharePoint groups
- **Automatic Model Detection**: Dynamic availability based on deployments
Models automatically appear/disappear in the chat interface based on your Azure OpenAI deployment configuration - no code changes required!

# About

This project is a fork of [microsoft/azurechat](https://github.com/microsoft/azurechat) with additional enhancements and customizations.

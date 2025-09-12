Add country code in excel or csv before writing the number like (911234567890  91xxxxxxxxxx) India.

### Prerequisites

1.  **Install Node.js**: Before you begin, you must have Node.js installed on your computer. If you don't have it, download and install it from the official [Node.js website](https://nodejs.org/). (The "LTS" version is recommended).

### Setup and Installation Guide

2.  **Prepare Project Folder**:
    * Create a new folder on your computer where you want to store the project (e.g., `C:\whatsapp-sender` or `/Users/yourname/whatsapp-sender`).
    * Copy all the code files we have created (`server.js`, `package.json`, etc.) into this new folder, making sure they are in the correct sub-folders (`app`, `views`, `public`, etc.) just as we designed.

3.  **Perform a "Clean Build" (Highly Recommended)**:
    * To ensure you start from a perfectly fresh state and avoid any old, corrupted data, go into your project folder and delete the following if they exist:
        * The `node_modules` folder
        * The `app/session` folder
        * The `.wwebjs_cache` folder
        * The `package-lock.json` file

4.  **Open a Terminal**:
    * Open your command prompt, PowerShell, or terminal.
    * Navigate into the project folder you created in step 2. For example:
        `cd C:\whatsapp-sender`

5.  **Install Dependencies**:
    * Once you are inside the project folder in your terminal, run the following command:
        `npm install`
    * This will read your `package.json` file and automatically download all the necessary libraries. **Note:** This step may take a few minutes as it also downloads a compatible version of the Chromium browser (~500 MB).

### Running the Application

6.  **Start the Server**:
    * After the installation is complete, run this command in the same terminal window:
        `npm start`
    * You should see a confirmation message in the terminal: `Server is running on http://localhost:3000`

7.  **Access the Web Interface**:
    * Open your regular web browser (like Google Chrome).
    * Go to the address: `http://localhost:3000`

8.  **Log In with WhatsApp**:
    * The application's dashboard will appear, showing a QR code.
    * Open WhatsApp on your phone, go to **Settings > Linked Devices > Link a Device**, and scan the QR code shown in your browser.
    * The page will update to show "You are authenticated!", and the system is now ready to use.

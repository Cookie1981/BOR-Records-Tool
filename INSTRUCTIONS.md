# Instructions

## One-Time Setup 

1. **Open Terminal** (Press `Cmd + Space`, type "Terminal", press Enter)

2. **Navigate to the folder where you downloaded software from github:**
   ie:
   ```bash
   cd /Users/mattchallinor/BOR-Records-Tool/
   ```

3. **Run the setup script:**
   ```bash
   ./setup.sh
   ```

   **Note:** You may be asked for your password during setup - this is normal and safe.
   **Note:** You WILL be asked for an API Key. You can get this from Golden Records, and the setup script tells you where to find it.

## Using the App - Every Time

1. **Open Terminal**

2. **Navigate to the app folder:**
   ```bash
   cd /Users/mattchallinor/BOR-Records-Tool/
   ```

3. **Launch the app:**
   ```bash
   ./launch.sh
   ```
   
   This will:
   - Start a Backend Node server
   - Automatically open your web browser ready to use the tool

4. **Use the web app** in your browser to upload your Excel files

5. **When finished**, press `Ctrl + C` in the Terminal to stop the application

## What You Need

- Obvs you need an internet connection in order to post the scores to Golden Records :)

## Troubleshooting

**If something goes wrong:**

**If the browser doesn't open automatically:**
- Manually open your web browser
- Go to: `http://localhost:3000`

**If you see "Permission denied" errors:**
```bash
chmod +x setup.sh launch.sh
```

## File Requirements

I've already created 2 Excel files for you to use, one for you and one for Kerry.
This includes some validation logic to stop reduce the chances of accidental errors.
You just need to start entering your scores.
You'll see the usual fields to fill out, but they are not all required.

Required Fields:

- date: dd/mm/yyyy format, but you'll be to type 1/1/25 and it will format to 01/01/25
- score 
- location 
- status (1-4: Practice/Club Event/Club Competition/Open Competition)
- Round: Drop down list available, start typing and it will filter, faster than using a mouse

Optional Fields:

- qualifying: true or false, defaults to false if blank
- record_qualifying: true or false, defaults to false if blank
- record_status: true or false, defaults to false if blank
- Class: Bow style. Same drop down behaviour as Round, but if you leave if blank the Tool will default to the style selected on the UI. 
- Category: Age Group. Same drop down behaviour as Round, but if you leave if blank the Tool will default to the Age Group selected on the UI. 
- hits, 10s, and xs - you probably want to fill this out, but if you leave them empty, they default to 0.

## Submitting Scores to Golder Records

Once you've entered your scores, you can submit them by launching the app (detailed above), using the UI to select your file, reviewing the data it's going to post, and hitting upload.
You should see your scores available in Golden Records fairly instantly.

